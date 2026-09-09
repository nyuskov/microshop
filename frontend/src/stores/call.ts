import { defineStore } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { ICE_SERVERS as CONFIG_ICE_SERVERS, WS_ORIGIN } from '@/config'

/** Тип вызова: только голос или голос + видео. */
export type CallKind = 'audio' | 'video'
/** Состояние текущего звонка в интерфейсе. */
export type CallStatus =
  | 'idle' // нет звонка
  | 'outgoing' // исходящий, ждём ответа
  | 'incoming' // входящий, звонит
  | 'active' // соединение установлено
  | 'ended' // завершён (показываем уведомление)

export interface CallPeer {
  id: number
  name: string
  avatarUrl?: string | null
}

interface SignalingMessage {
  type: string
  call_id?: string
  from_user_id?: number
  to_user_id?: number
  kind?: CallKind
  sdp?: string
  candidate?: RTCIceCandidateInit
  reason?: string
}

const WS_PATH = '/api/v1/ws/calls'
const RING_OUT_TIMEOUT_MS = 45_000

// «Лёгкое» видео: невысокое разрешение и частота — видеозвонок должен работать
// и через TURN-релей на мобильной сети (высокий битрейт 720p «валит» медиа,
// тогда как аудио-звонок проходит). Битрейт дополнительно режется кодом ниже.
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640, max: 640 },
  height: { ideal: 480, max: 480 },
  frameRate: { ideal: 24, max: 30 }
}

// ICE-серверы централизованы в config.ts (переопределяются через VITE_ICE_SERVERS);
// для звонков за «симметричным» NAT нужен TURN-сервер (см. docs/turn.md).
const ICE_SERVERS: RTCConfiguration = { iceServers: CONFIG_ICE_SERVERS }

/* ===================== Модульные (не реактивные) ресурсы звонка ===================== */

let socket: WebSocket | null = null
let peerConnection: RTCPeerConnection | null = null
let localMedia: MediaStream | null = null
let remoteMedia: MediaStream | null = null
let pendingOffer: { callId: string; kind: CallKind; sdp: string } | null = null

let ringTimer: ReturnType<typeof setTimeout> | undefined
let audioContext: AudioContext | null = null
let unlockBound = false

function socketUrl(token: string): string {
  return `${WS_ORIGIN}${WS_PATH}?token=${encodeURIComponent(token)}`
}

function stopAllTracks(stream: MediaStream | null | undefined) {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

/* ------------------ Гудки (WebAudio, без внешних файлов) ------------------ */

function stopRingtone() {
  if (ringTimer !== undefined) {
    window.clearTimeout(ringTimer)
    ringTimer = undefined
  }
  if (audioContext) {
    void audioContext.close().catch(() => undefined)
    audioContext = null
  }
}

type RingNote = { at: number; f: number; d: number; vol?: number }

/**
 * Входящий звонок — полифоничный «маримбовый» перезвон (оригинальная фраза):
 * мелодия E5→G5→A5→B5→D6→E6 с низким басом и «эхом».
 */
const INCOMING_RING: RingNote[] = [
  { at: 0.0, f: 659.25, d: 0.8, vol: 0.5 }, // E5
  { at: 0.0, f: 164.81, d: 1.5, vol: 0.3 }, // E3 (бас)
  { at: 0.16, f: 783.99, d: 0.8, vol: 0.42 }, // G5
  { at: 0.32, f: 880.0, d: 0.8, vol: 0.42 }, // A5
  { at: 0.48, f: 987.77, d: 0.9, vol: 0.44 }, // B5
  { at: 0.64, f: 1174.66, d: 0.9, vol: 0.4 }, // D6
  { at: 0.84, f: 1318.51, d: 1.0, vol: 0.42 }, // E6
  { at: 1.16, f: 987.77, d: 0.7, vol: 0.28 }, // эхо B5
  { at: 1.34, f: 880.0, d: 0.7, vol: 0.26 }, // эхо A5
  { at: 1.52, f: 783.99, d: 0.8, vol: 0.26 }, // эхо G5
  { at: 1.72, f: 659.25, d: 1.0, vol: 0.28 }, // эхо E5
  { at: 1.72, f: 164.81, d: 1.7, vol: 0.24 } // E3 (бас)
]
/** Гудки «вызова» для звонящего — мягкая пара маримбовых нот. */
const OUTGOING_RING: RingNote[] = [
  { at: 0.0, f: 523.25, d: 0.6, vol: 0.4 }, // C5
  { at: 0.0, f: 130.81, d: 1.1, vol: 0.24 }, // C3 (низ)
  { at: 0.62, f: 523.25, d: 0.6, vol: 0.4 } // C5
]

/**
 * Нота в стиле маримбы: сильная основная + «бьющая» партиала ~4× (даёт
 * характерное дребезжание деревянного барового инструмента) + яркий верх.
 */
function marimbaNote(freq: number, when: number, dur: number, volume: number) {
  if (!audioContext) return
  const ctx = audioContext as AudioContext
  const part = (ratio: number, rel: number, decay: number, type: OscillatorType = 'sine') => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq * ratio
    const peak = Math.max(0.0002, volume * rel)
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur * decay)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(when)
    osc.stop(when + dur + 0.04)
  }
  part(1, 1, 1) // фундаментал
  part(3.98, 0.45, 0.8) // «бьющая» партиала
  part(9.2, 0.14, 0.6) // яркий верх
}

/** Играет полифоничную фразу (ноты могут перекрываться) и повторяет её. */
function scheduleRing(notes: RingNote[], loopMs: number) {
  if (ringTimer !== undefined) {
    window.clearTimeout(ringTimer)
  }
  ringTimer = window.setTimeout(function tick() {
    const ctx = audioContext
    if (!ctx) return
    const base = ctx.currentTime + 0.08
    notes.forEach((n) => marimbaNote(n.f, base + n.at, n.d, n.vol ?? 0.4))
    ringTimer = window.setTimeout(tick, loopMs)
  }, 150)
}

/** Лёгкая вибрация при входящем звонке (Android, когда страница видима). */
function vibrateRing() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([200, 90, 200, 90, 200, 90, 200])
    }
  } catch {
    /* вибрация недоступна — не критично */
  }
}

/** Возобновляет аудио-контекст, если браузер приостановил его (автоплей). */
function resumeAudioIfSuspended() {
  if (audioContext && audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => undefined)
  }
}

/**
 * Браузеры блокируют звук без «жеста» пользователя. Привязываем возобновление
 * контекста к первому же клику/тапу — тогда рингтон сработает даже для
 * входящего звонка (пришедшего без участия пользователя).
 */
function bindAudioUnlockOnce() {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true
  const events = ['pointerdown', 'keydown', 'touchstart'] as const
  events.forEach((eventName) =>
    window.addEventListener(eventName, resumeAudioIfSuspended, { passive: true })
  )
}

bindAudioUnlockOnce()

/* --------------- Вывод звука собеседника (Web Audio gain) ---------------
   На телефонах/части браузеров element.volume у медиа-стримов игнорируется,
   поэтому «тихий» режим (до включения громкой связи) делаем через честный
   GainNode: громкость применяется гарантированно и не зависит от элемента. */
let callOutputCtx: AudioContext | null = null
let callOutputGain: GainNode | null = null
let callOutputSource: MediaStreamAudioSourceNode | null = null
let callOutputStream: MediaStream | null = null

/** Создаёт/возобновляет контекст вывода. Звать в жесте пользователя. */
function ensureCallOutput() {
  if (!callOutputCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    callOutputCtx = new Ctor()
    callOutputGain = callOutputCtx.createGain()
    callOutputGain.gain.value = 0.12
    callOutputGain.connect(callOutputCtx.destination)
  }
  if (callOutputCtx.state === 'suspended') {
    void callOutputCtx.resume().catch(() => undefined)
  }
}

/** Подключает удалённый поток в цепочку вывода (после ontrack). */
function wireRemoteOutput(stream: MediaStream | null) {
  if (!stream || stream.getAudioTracks().length === 0) return
  if (stream === callOutputStream && callOutputSource) return
  if (callOutputSource) {
    try {
      callOutputSource.disconnect()
    } catch {
      /* ignore */
    }
    callOutputSource = null
  }
  ensureCallOutput()
  if (!callOutputCtx || !callOutputGain) return
  try {
    callOutputSource = callOutputCtx.createMediaStreamSource(stream)
    callOutputSource.connect(callOutputGain)
    callOutputStream = stream
  } catch {
    /* не удалось подключить вывод — не критично */
  }
}

/** Громкость собеседника: 1 — громко, меньше — «к уху». */
function setRemoteOutputVolume(volume: number) {
  if (callOutputGain && callOutputCtx) {
    callOutputGain.gain.setValueAtTime(volume, callOutputCtx.currentTime)
  }
}

function teardownCallOutput() {
  if (callOutputSource) {
    try {
      callOutputSource.disconnect()
    } catch {
      /* ignore */
    }
    callOutputSource = null
  }
  callOutputGain = null
  callOutputStream = null
  if (callOutputCtx) {
    void callOutputCtx.close().catch(() => undefined)
    callOutputCtx = null
  }
}

function startRingtone(kind: 'outgoing' | 'incoming') {
  stopRingtone()
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioContext = new Ctor()
    bindAudioUnlockOnce()
    resumeAudioIfSuspended()
    // Входящий — полифоничный маримбовый перезвон; исходящему — мягкие гудки.
    if (kind === 'outgoing') {
      scheduleRing(OUTGOING_RING, 2200)
    } else {
      scheduleRing(INCOMING_RING, 3600)
      vibrateRing()
    }
  } catch {
    /* Аудио недоступно — звонок идёт без гудков */
  }
}

/* ============================== Store ============================== */

interface CallState {
  status: CallStatus
  kind: CallKind
  callId: string | null
  peerId: number | null
  peerName: string
  peerAvatar: string | null
  micOn: boolean
  videoOn: boolean
  seconds: number
  connected: boolean
  notice: string
  secondsTimer: ReturnType<typeof setInterval> | undefined
  ringOutTimer: ReturnType<typeof setTimeout> | undefined
}

const DEFAULT_STATE: CallState = {
  status: 'idle',
  kind: 'audio',
  callId: null,
  peerId: null,
  peerName: '',
  peerAvatar: null,
  micOn: true,
  videoOn: true,
  seconds: 0,
  connected: false,
  notice: '',
  secondsTimer: undefined,
  ringOutTimer: undefined
}

function makeCallId(): string {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sendMessage(message: SignalingMessage) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

export const useCallStore = defineStore('call', {
  state: (): CallState => ({ ...DEFAULT_STATE }),

  getters: {
    isBusy: (state) => state.status === 'active' || state.status === 'outgoing',
    formattedTime: (state): string => {
      const m = Math.floor(state.seconds / 60)
      const s = state.seconds % 60
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    }
  },

  actions: {
    /** Устанавливает информацию о собеседнике (для входящего звонка). */
    setPeerInfo(peer: { name: string; avatarUrl?: string | null }) {
      this.peerName = peer.name
      this.peerAvatar = peer.avatarUrl ?? null
    },

    /** Подключает сигнальный WebSocket (при авторизации). */
    async connect(): Promise<boolean> {
      const authStore = useAuthStore()
      const token = authStore.accessToken
      if (!token) return false
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      ) {
        if (socket.readyState === WebSocket.OPEN) return true
        return this._waitForSocketOpen()
      }
      socket = new WebSocket(socketUrl(token))
      socket.onopen = () => {
        this.connected = true
      }
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as SignalingMessage
          this._handleMessage(data)
        } catch {
          /* некорректное сообщение — игнорируем */
        }
      }
      socket.onclose = () => {
        this.connected = false
        socket = null
        if (this.status === 'active' || this.status === 'outgoing') {
          this._forceEnd('Соединение с сервером прервано')
        } else if (this.status === 'idle') {
          this._scheduleReconnect()
        }
      }
      return this._waitForSocketOpen()
    },

    /** Ожидает, пока сигнальный сокет откроется (до 9 секунд). */
    _waitForSocketOpen(): Promise<boolean> {
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          window.clearInterval(poll)
          resolve(socket !== null && socket.readyState === WebSocket.OPEN)
        }, 9000)
        const poll = window.setInterval(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            window.clearInterval(poll)
            window.clearTimeout(timer)
            resolve(true)
          } else if (!socket || socket.readyState === WebSocket.CLOSED) {
            window.clearInterval(poll)
            window.clearTimeout(timer)
            resolve(false)
          }
        }, 120)
      })
    },

    _scheduleReconnect() {
      const authStore = useAuthStore()
      if (!authStore.isAuthenticated || this.status !== 'idle') return
      window.setTimeout(() => {
        if (this.status === 'idle' && useAuthStore().isAuthenticated) {
          void this.connect()
        }
      }, 2500)
    },

    /** Закрывает сигнальный канал (при выходе из аккаунта). */
    disconnect() {
      if (this.status !== 'idle') {
        this._cleanup()
      }
      if (socket) {
        socket.onclose = null
        socket.close()
        socket = null
      }
      this.connected = false
    },

    _handleMessage(message: SignalingMessage) {
      const from = message.from_user_id ?? 0
      const callId = message.call_id ?? ''
      switch (message.type) {
        case 'call-offer': {
          if (this.status !== 'idle') {
            // Уже занят — автоматически отклоняем.
            sendMessage({ type: 'call-decline', to_user_id: from, call_id: callId, reason: 'busy' })
            return
          }
          pendingOffer = { callId, kind: message.kind ?? 'audio', sdp: message.sdp ?? '' }
          this.$patch({
            status: 'incoming',
            kind: message.kind ?? 'audio',
            callId,
            peerId: from,
            peerName: `@${from}`,
            peerAvatar: null
          })
          startRingtone('incoming')
          break
        }
        case 'call-answer': {
          if (this.status === 'outgoing' && this.callId === callId && peerConnection) {
            if (message.sdp) {
              void peerConnection.setRemoteDescription({ type: 'answer', sdp: message.sdp })
            }
            this._becomeActive()
          }
          break
        }
        case 'ice-candidate': {
          const candidate = message.candidate
          if (peerConnection && candidate && this.callId === callId) {
            void peerConnection
              .addIceCandidate(new RTCIceCandidate(candidate))
              .catch(() => undefined)
          }
          break
        }
        case 'call-cancel': {
          if (this.status === 'incoming' && this.callId === callId) {
            this._cleanup()
            this.notice = 'Звонок отменён'
          }
          break
        }
        case 'call-decline': {
          if (this.status === 'outgoing' && this.callId === callId) {
            this._cleanup()
            this.notice = message.reason === 'busy' ? 'Абонент занят' : 'Абонент отклонил звонок'
          }
          break
        }
        case 'call-end': {
          if (this.callId === callId) {
            this._cleanup()
            this.notice = 'Звонок завершён'
          }
          break
        }
        case 'call-unavailable': {
          if (this.status === 'outgoing' && this.callId === callId) {
            this._cleanup()
            this.notice = 'Абонент сейчас недоступен'
          }
          break
        }
        default:
          break
      }
    },

    /** Начать звонок собеседнику (голос или видео). */
    async startCall(peer: CallPeer, kind: CallKind) {
      if (this.status !== 'idle') return
      // Контекст вывода создаём в жесте пользователя (иначе аудио заглушится).
      ensureCallOutput()
      this.resetNotice()
      this.$patch({
        status: 'outgoing',
        kind,
        callId: makeCallId(),
        peerId: peer.id,
        peerName: peer.name,
        peerAvatar: peer.avatarUrl ?? null,
        micOn: true,
        videoOn: true,
        seconds: 0
      })
      startRingtone('outgoing')

      const connected = await this.connect()
      if (!connected) {
        this._cleanup()
        this.notice = 'Не удалось подключиться к серверу звонков'
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true
          },
          video: kind === 'video' ? VIDEO_CONSTRAINTS : false
        })
        localMedia = stream
        peerConnection = new RTCPeerConnection(ICE_SERVERS)
        this._wirePeerConnection(peerConnection)
        stream.getTracks().forEach((track) => peerConnection?.addTrack(track, stream))

        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        sendMessage({
          type: 'call-offer',
          to_user_id: peer.id,
          call_id: this.callId ?? '',
          kind,
          sdp: offer.sdp ?? ''
        })
        this._armRingOutTimer()
      } catch {
        this._cleanup()
        this.notice =
          kind === 'video'
            ? 'Не удалось получить доступ к камере/микрофону'
            : 'Не удалось получить доступ к микрофону'
      }
    },

    /** Принять входящий звонок. */
    async acceptCall() {
      if (this.status !== 'incoming' || !pendingOffer) return
      stopRingtone()
      // Контекст вывода создаём в жесте пользователя (иначе аудио заглушится).
      ensureCallOutput()
      const kind = pendingOffer.kind
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: kind === 'video' ? VIDEO_CONSTRAINTS : false
        })
        localMedia = stream
        peerConnection = new RTCPeerConnection(ICE_SERVERS)
        this._wirePeerConnection(peerConnection)
        stream.getTracks().forEach((track) => peerConnection?.addTrack(track, stream))
        await peerConnection.setRemoteDescription({ type: 'offer', sdp: pendingOffer.sdp })
        const answer = await peerConnection.createAnswer()
        await peerConnection.setLocalDescription(answer)
        this.kind = kind
        sendMessage({
          type: 'call-answer',
          to_user_id: this.peerId ?? 0,
          call_id: this.callId ?? '',
          sdp: answer.sdp ?? ''
        })
        this._becomeActive()
      } catch {
        this._cleanup()
        this.notice = 'Не удалось получить доступ к камере/микрофону'
      }
    },

    /** Отклонить входящий звонок. */
    declineCall() {
      if (this.status !== 'incoming') return
      sendMessage({
        type: 'call-decline',
        to_user_id: this.peerId ?? 0,
        call_id: this.callId ?? ''
      })
      this._cleanup()
    },

    /** Входящий рингтон для экрана «Входящий звонок…» (до доставки offer). */
    ringIncoming() {
      startRingtone('incoming')
    },

    /** Полностью останавливает рингтон/гудки. */
    stopRinging() {
      stopRingtone()
    },

    /** Отказ по звонку, когда offer ещё не доставлен (экран запуска из push). */
    declineCallTo(peerId: number, callId: string) {
      if (this.status !== 'idle') {
        this.declineCall()
        return
      }
      sendMessage({ type: 'call-decline', to_user_id: peerId, call_id: callId })
      this._cleanup()
    },

    /** Отменить исходящий звонок до ответа. */
    cancelCall() {
      if (this.status !== 'outgoing') return
      sendMessage({
        type: 'call-cancel',
        to_user_id: this.peerId ?? 0,
        call_id: this.callId ?? ''
      })
      this._cleanup()
    },

    /** Завершить активный звонок. */
    endCall() {
      if (this.status === 'idle') return
      sendMessage({
        type: 'call-end',
        to_user_id: this.peerId ?? 0,
        call_id: this.callId ?? ''
      })
      this._cleanup()
    },

    _becomeActive() {
      stopRingtone()
      this._clearRingOutTimer()
      this.$patch({ status: 'active', seconds: 0 })
      if (this.secondsTimer !== undefined) {
        window.clearInterval(this.secondsTimer)
      }
      this.secondsTimer = window.setInterval(() => {
        this.seconds += 1
      }, 1000)
      // Режем битрейт видео, чтобы звонок стабильно шёл через TURN/мобильный.
      void this._capVideoBitrate()
    },

    /** Ограничивает битрейт отправляемого видео (~300 Кбит/с). */
    async _capVideoBitrate(): Promise<void> {
      try {
        const sender = peerConnection?.getSenders().find((s) => s.track && s.track.kind === 'video')
        if (!sender) return
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}]
        }
        params.encodings.forEach((encoding) => {
          encoding.maxBitrate = 300_000
        })
        await sender.setParameters(params)
      } catch {
        /* ограничение битрейта — не критично */
      }
    },

    /** Громкость собеседника: 1 — громко, <1 — «к уху» (Web Audio gain). */
    setOutputVolume(volume: number) {
      setRemoteOutputVolume(volume)
    },

    /** Готов ли Web Audio вывод (контекст запущен и поток подключён). */
    outputReady(): boolean {
      return (
        callOutputCtx !== null && callOutputCtx.state === 'running' && callOutputSource !== null
      )
    },

    /** Возобновить Web Audio (вызывать по тапу/каждому тику). */
    resumeOutput() {
      ensureCallOutput()
    },

    /** Переключить микрофон. */
    toggleMic() {
      this.micOn = !this.micOn
      localMedia?.getAudioTracks().forEach((track) => {
        track.enabled = this.micOn
      })
    },

    /** Переключить камеру. */
    toggleCamera() {
      if (this.kind !== 'video') return
      this.videoOn = !this.videoOn
      localMedia?.getVideoTracks().forEach((track) => {
        track.enabled = this.videoOn
      })
    },

    /** Возвращает текущий локальный поток (для превью). */
    getLocalStream(): MediaStream | null {
      return localMedia
    },

    /** Возвращает текущий удалённый поток (для видео собеседника). */
    getRemoteStream(): MediaStream | null {
      return remoteMedia
    },

    /** Сбросить уведомление. */
    resetNotice() {
      this.notice = ''
    },

    _armRingOutTimer() {
      this._clearRingOutTimer()
      this.ringOutTimer = window.setTimeout(() => {
        if (this.status === 'outgoing') {
          this.cancelCall()
          this.notice = 'Абонент не отвечает'
        }
      }, RING_OUT_TIMEOUT_MS)
    },

    _clearRingOutTimer() {
      if (this.ringOutTimer !== undefined) {
        window.clearTimeout(this.ringOutTimer)
        this.ringOutTimer = undefined
      }
    },

    /** Принудительно завершает звонок (обрыв соединения и т.п.). */
    _forceEnd(message: string) {
      this._cleanup()
      this.notice = message
    },

    _cleanup() {
      stopRingtone()
      this._clearRingOutTimer()
      if (this.secondsTimer !== undefined) {
        window.clearInterval(this.secondsTimer)
        this.secondsTimer = undefined
      }
      if (peerConnection) {
        peerConnection.onicecandidate = null
        peerConnection.ontrack = null
        peerConnection.close()
        peerConnection = null
      }
      stopAllTracks(localMedia)
      stopAllTracks(remoteMedia)
      teardownCallOutput()
      localMedia = null
      remoteMedia = null
      pendingOffer = null
      this.$patch({ ...DEFAULT_STATE, connected: this.connected })
    },

    _wirePeerConnection(connection: RTCPeerConnection) {
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage({
            type: 'ice-candidate',
            to_user_id: this.peerId ?? 0,
            call_id: this.callId ?? '',
            candidate: event.candidate.toJSON()
          })
        }
      }
      connection.ontrack = (event) => {
        // Собираем удалённый поток надёжно: не затираем уже пришедшие треки
        // последним событием (иначе на части браузеров остаётся только аудио
        // или только видео — видео собеседника «не видно»).
        const incoming = event.streams && event.streams[0]
        let stream = remoteMedia
        if (!stream) {
          stream = new MediaStream()
          remoteMedia = stream
        }
        if (incoming && incoming !== stream) {
          incoming.getTracks().forEach((track) => {
            if (!stream.getTracks().includes(track)) {
              stream.addTrack(track)
            }
          })
        }
        if (!stream.getTracks().includes(event.track)) {
          stream.addTrack(event.track)
        }
        // Звук собеседника — через Web Audio (не зависит от element.volume).
        wireRemoteOutput(stream)
      }
    }
  }
})
