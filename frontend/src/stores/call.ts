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

function tone(freq: number, duration: number, when: number, volume: number) {
  if (!audioContext) return
  const osc = audioContext.createOscillator()
  const gain = audioContext.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(volume, when + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
  osc.connect(gain)
  gain.connect(audioContext.destination)
  osc.start(when)
  osc.stop(when + duration + 0.05)
}

function playSequence(freq: number, pattern: number[], volume: number) {
  if (ringTimer !== undefined) {
    window.clearTimeout(ringTimer)
  }
  ringTimer = window.setTimeout(function tick() {
    const ctx = audioContext
    if (!ctx) return
    const start = ctx.currentTime + 0.05
    let cursor = start
    pattern.forEach((dur) => {
      tone(freq, dur, cursor, volume)
      cursor += dur + 0.08
    })
    ringTimer = window.setTimeout(tick, (cursor - start + 0.3) * 1000)
  }, 100)
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
    // Исходящий — короткие гудки 425 Гц; входящий — «телефонный» рингтон 700/900 Гц.
    if (kind === 'outgoing') {
      playSequence(425, [0.28, 0.28, 0.28, 0.28], 0.12)
    } else {
      playSequence(700, [0.22, 0.22], 0.12)
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
          video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
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
      const kind = pendingOffer.kind
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
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
        if (event.streams && event.streams[0]) {
          remoteMedia = event.streams[0]
        } else {
          remoteMedia = new MediaStream([event.track])
        }
      }
    }
  }
})
