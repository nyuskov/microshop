import { defineStore } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { ICE_SERVERS as CONFIG_ICE_SERVERS, WS_ORIGIN } from '@/config'
import { fetchIceServers } from '@/services/iceServers'
import { kindAfterScreenShare } from '@/utils/callMode'
import {
  chooseDeviceId,
  groupDevices,
  readCallDevices,
  writeCallDevices
} from '@/utils/callDevices'

/** Тип вызова: только голос или голос + видео. */
export type CallKind = 'audio' | 'video'
/** Почему показ экрана недоступен (или 'ok', если всё в порядке). */
export type ScreenShareSupport = 'ok' | 'insecure' | 'mobile' | 'unsupported'

/**
 * Проверяет, можно ли вообще включить показ экрана в этом окружении.
 * `getDisplayMedia` требует защищённый контекст (HTTPS или localhost), а в
 * мобильных браузерах и WebView захват экрана не поддерживается вовсе — там
 * звонок идёт, а API отсутствует, поэтому кнопку лучше не показывать.
 */
export function screenShareSupport(): ScreenShareSupport {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return 'unsupported'
  }
  if (!window.isSecureContext || !navigator.mediaDevices) return 'insecure'
  if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    return isMobile ? 'mobile' : 'unsupported'
  }
  return 'ok'
}

/** Текст для пользователя: почему показа экрана не будет. */
export function screenShareNotice(support: ScreenShareSupport): string {
  if (support === 'insecure') {
    return 'Показ экрана работает только по защищённому соединению (HTTPS)'
  }
  if (support === 'mobile') {
    return 'На телефоне показ экрана недоступен — включите его с компьютера'
  }
  if (support === 'unsupported') return 'Браузер не поддерживает демонстрацию экрана'
  return ''
}

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
  /** Для ``call-screen`` — начинает/заканчивает ли собеседник показ экрана. */
  sharing?: boolean
}

const WS_PATH = '/api/v1/ws/calls'
/**
 * Сколько ждём ответа. У собеседника приложение может быть закрыто: push,
 * холодный старт и нажатие «Ответить» должны уложиться в это время, поэтому
 * таймаут заметно больше обычных 30 секунд.
 */
const RING_OUT_TIMEOUT_MS = 60_000

/** Сколько ждём восстановления связи, прежде чем завершить звонок. */
const LINK_RECOVERY_WINDOW_MS = 12_000
/** Как часто пробуем переподключить сигналинг во время звонка. */
const LINK_RETRY_MS = 1500
/** Пауза после «disconnected»: соединение часто восстанавливается само. */
const ICE_DISCONNECTED_GRACE_MS = 3500
/** Пауза между попытками перезапуска ICE. */
const ICE_RETRY_DELAY_MS = 5000
const ICE_RESTART_MAX_ATTEMPTS = 3

// «Лёгкое» видео: невысокое разрешение и частота — видеозвонок должен работать
// и через TURN-релей на мобильной сети (высокий битрейт 720p «валит» медиа,
// тогда как аудио-звонок проходит). Битрейт дополнительно режется кодом ниже.
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640, max: 640 },
  height: { ideal: 480, max: 480 },
  frameRate: { ideal: 24, max: 30 }
}

// «Лёгкий» аудиоконстрейнт: эхоподавление и шумодав — как в обычном разговоре.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true
}

// Демонстрация экрана: чёткость важнее плавности (текст мелкий), поэтому 15 fps.
const SCREEN_CONSTRAINTS: MediaTrackConstraints = {
  frameRate: { ideal: 15, max: 30 }
}

// ICE-серверы: TURN-креды приходят с бэкенда временными (см. services/iceServers.ts),
// если сервер не ответил — работаем по STUN из config (звонок важнее свежих кредов).
// Точка обновления — перед каждым звонком (`_iceConfiguration()`).
let iceConfiguration: RTCConfiguration = { iceServers: CONFIG_ICE_SERVERS }

/** Готовит конфигурацию ICE: тянет свежие TURN-креды под текущего пользователя. */
async function loadIceConfiguration(): Promise<RTCConfiguration> {
  const servers = await fetchIceServers()
  iceConfiguration = { iceServers: servers }
  return iceConfiguration
}

/* ===================== Модульные (не реактивные) ресурсы звонка ===================== */

let socket: WebSocket | null = null
let peerConnection: RTCPeerConnection | null = null
let localMedia: MediaStream | null = null
let remoteMedia: MediaStream | null = null
let pendingOffer: { callId: string; kind: CallKind; sdp: string } | null = null

// Дорожки демонстрации экрана и «отложенная» камера: пока идёт показ экрана,
// камеру гасим (иначе горит индикатор и тратится батарея), а при остановке
// показа включаем заново — уже с выбранным в настройках устройством.
let screenTrack: MediaStreamTrack | null = null
/** Видеолиния, в которой идёт показ экрана (нужна, чтобы вернуть её назад/убрать). */
let screenSender: RTCRtpSender | null = null
/** Каким был звонок до показа экрана: аудиозвонок после остановки возвращается в аудио. */
let shareReturnKind: CallKind = 'video'

// Счётчик «поколений» пересогласования: ответ на устаревший offer игнорируем,
// иначе два одновременных пересогласования ломают SDP.
let renegotiateSeq = 0

let ringTimer: ReturnType<typeof setTimeout> | undefined
/** Отсчёт до «собеседник так и не вернулся» после перезагрузки страницы. */
let rejoinTimer: ReturnType<typeof setTimeout> | undefined
/* Восстановление связи при смене сети (Wi-Fi → LTE и обратно). */
let iceRecoveryTimer: ReturnType<typeof setTimeout> | undefined
let iceRestartAttempts = 0
let socketRetryTimer: ReturnType<typeof setTimeout> | undefined
let socketRetryDeadline = 0
/** Инициатор звонка: он перезапускает ICE первым, отвечающий — с задержкой. */
let isCaller = false
let audioContext: AudioContext | null = null
let unlockBound = false

/* --------- Идущий звонок переживает перезагрузку страницы --------- */

/**
 * Где лежит «памятка» об идущем звонке.
 *
 * sessionStorage, а не localStorage: запись нужна только этой вкладке и только
 * до перезагрузки. Если приложение закрыли, звонок давно завершён — поднимать
 * его при следующем запуске нельзя.
 */
const CALL_SESSION_KEY = 'pismo_call_session'
/** Сколько считаем «мы только что перезагрузились» (дольше — это уже другой случай). */
const CALL_REJOIN_WINDOW_MS = 60_000
/** Как часто отмечаем идущий звонок «живым» (секунды, кратные этому числу). */
const CALL_TOUCH_EVERY_SECONDS = 5
/** Сколько ждём пересогласования от собеседника, прежде чем считать звонок сброшенным. */
const CALL_REJOIN_TIMEOUT_MS = 12_000

interface StoredCall {
  callId: string
  peerId: number
  kind: CallKind
  /** Когда звонок стал активным — чтобы вернуть честный счётчик времени. */
  startedAt: number
  /**
   * Когда мы в последний раз видели звонок живым.
   *
   * Именно по этому полю решаем, восстанавливать ли звонок: разговор мог идти
   * час, и это не повод считать запись устаревшей — важно, чтобы после
   * перезагрузки звонок был ещё «свежим».
   */
  touchedAt: number
}

function rememberActiveCall(call: StoredCall): void {
  try {
    window.sessionStorage.setItem(CALL_SESSION_KEY, JSON.stringify(call))
  } catch {
    /* приватный режим — просто не сможем восстановить звонок */
  }
}

function forgetActiveCall(): void {
  try {
    window.sessionStorage.removeItem(CALL_SESSION_KEY)
  } catch {
    /* нечего чистить */
  }
}

/** Звонок, который шёл до перезагрузки страницы (или null). */
function callAfterReload(): StoredCall | null {
  try {
    const raw = window.sessionStorage.getItem(CALL_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCall
    if (!parsed?.callId || !parsed.peerId) return null
    const touched = parsed.touchedAt ?? parsed.startedAt ?? 0
    if (Date.now() - touched > CALL_REJOIN_WINDOW_MS) return null
    return parsed
  } catch {
    return null
  }
}

function socketUrl(token: string): string {
  return `${WS_ORIGIN}${WS_PATH}?token=${encodeURIComponent(token)}`
}

function stopAllTracks(stream: MediaStream | null | undefined) {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

/** Заменяет в потоке дорожку того же вида (камера/микрофон) новой. */
function swapTrackInStream(
  stream: MediaStream | null,
  track: MediaStreamTrack | null,
  kind: 'audio' | 'video'
) {
  if (!stream) return
  stream.getTracks().forEach((existing) => {
    if (existing.kind === kind && existing !== track) {
      stream.removeTrack(existing)
    }
  })
  if (track && !stream.getTracks().includes(track)) {
    stream.addTrack(track)
  }
}

/** Медиа-констрейнты с учётом выбранного в настройках устройства. */
function mediaConstraints(
  kind: CallKind,
  cameraId?: string,
  micId?: string
): MediaStreamConstraints {
  const audio: MediaTrackConstraints = { ...AUDIO_CONSTRAINTS }
  if (micId) audio.deviceId = { exact: micId }
  if (kind !== 'video') return { audio, video: false }
  const video: MediaTrackConstraints = { ...VIDEO_CONSTRAINTS }
  if (cameraId) video.deviceId = { exact: cameraId }
  return { audio, video }
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
  /** Показываю свой экран собеседнику. */
  screenSharing: boolean
  /** Теряли связь и восстанавливаем (смена сети): показываем «Переподключаемся…». */
  reconnecting: boolean
  /** Собеседник показывает экран. */
  peerScreenSharing: boolean
  /** Свои устройства (по мнению браузера) и выбранные среди них. */
  cameras: MediaDeviceInfo[]
  microphones: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
  selectedCamera: string
  selectedMic: string
  selectedSpeaker: string
  seconds: number
  connected: boolean
  notice: string
  secondsTimer: ReturnType<typeof setInterval> | undefined
  ringOutTimer: ReturnType<typeof setTimeout> | undefined
  /** Сколько раз повторили уже принятый/идущий вызов (чтобы погасить уведомление). */
  ignoredCallOffers: number
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
  screenSharing: false,
  peerScreenSharing: false,
  /** Теряли связь и восстанавливаем: в оверлее показываем «Переподключаемся…». */
  reconnecting: false,
  cameras: [],
  microphones: [],
  speakers: [],
  selectedCamera: '',
  selectedMic: '',
  selectedSpeaker: '',
  seconds: 0,
  connected: false,
  notice: '',
  secondsTimer: undefined,
  ringOutTimer: undefined,
  ignoredCallOffers: 0
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
    /** Можно ли переключать камеру/микрофон по ходу звонка. */
    canSwitchDevices: (state) => state.status === 'active',
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
        if (this.status === 'active' || this.status === 'outgoing') {
          // Сигналинг вернулся: сообщаем об этом и перезапускаем ICE — медиа
          // шло по адресам прежней сети.
          this.reconnecting = false
          if (socketRetryTimer !== undefined) {
            window.clearTimeout(socketRetryTimer)
            socketRetryTimer = undefined
          }
          socketRetryDeadline = 0
          iceRestartAttempts = 0
          if (peerConnection) this._scheduleIceRestart(ICE_RETRY_DELAY_MS)
        } else if (this.status === 'idle') {
          // Страница могла быть перезагружена во время звонка (случайный жест
          // «потянуть вниз», manual reload) — поднимаем его.
          void this.recoverCallAfterReload()
        }
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
          // Смена сети (Wi-Fi → LTE) рвёт WebSocket, но звонок при этом жив:
          // даём время переподключиться и перезапустить ICE, и только если
          // связь не вернулась — завершаем.
          this.reconnecting = true
          this._scheduleSocketRetry()
        } else if (this.status === 'idle') {
          this._scheduleReconnect()
        }
      }
      return this._waitForSocketOpen()
    },

    /**
     * Пробует вернуть сигналинг, пока не истекло окно восстановления.
     * Вызывается, когда сокет закрылся во время звонка.
     */
    _scheduleSocketRetry() {
      if (socketRetryDeadline === 0) {
        socketRetryDeadline = Date.now() + LINK_RECOVERY_WINDOW_MS
      }
      if (socketRetryTimer !== undefined) window.clearTimeout(socketRetryTimer)
      socketRetryTimer = window.setTimeout(() => {
        socketRetryTimer = undefined
        if (this.status !== 'active' && this.status !== 'outgoing') return
        if (useAuthStore().isAuthenticated && (socket === null || socket.readyState > 1)) {
          void this.connect()
        }
        if (Date.now() >= socketRetryDeadline) {
          this.reconnecting = false
          socketRetryDeadline = 0
          if (peerConnection && peerConnection.iceConnectionState === 'connected') {
            return
          }
          this._forceEnd('Связь потеряна — звонок завершён')
          return
        }
        this._scheduleSocketRetry()
      }, LINK_RETRY_MS)
    },

    /** Состояние ICE: перезапуск при смене сети и завершение, если не вышло. */
    _handleIceState(connection: RTCPeerConnection) {
      const state = connection.iceConnectionState
      if (state === 'connected' || state === 'completed') {
        this._resetIceRecovery()
        // Ответ собеседника мог потеряться (обрыв сигналинга): если медиа уже
        // идёт, звонок состоялся — переводим интерфейс в разговор.
        if (this.status === 'outgoing') this._becomeActive()
        return
      }
      if (state === 'disconnected') {
        // Отвечающая сторона ждёт дольше: если перезапуск сделает зовущий,
        // попытка собеседника не понадобится (состояние станет connected).
        this._scheduleIceRestart(
          isCaller ? ICE_DISCONNECTED_GRACE_MS : ICE_DISCONNECTED_GRACE_MS * 1.7
        )
        return
      }
      if (state === 'failed') void this._restartIce(connection)
    },

    _resetIceRecovery() {
      if (iceRecoveryTimer !== undefined) {
        window.clearTimeout(iceRecoveryTimer)
        iceRecoveryTimer = undefined
      }
      if (rejoinTimer !== undefined) {
        window.clearTimeout(rejoinTimer)
        rejoinTimer = undefined
      }
      iceRestartAttempts = 0
      if (this.reconnecting && this.connected) this.reconnecting = false
    },

    _scheduleIceRestart(delay: number) {
      if (iceRecoveryTimer !== undefined) window.clearTimeout(iceRecoveryTimer)
      iceRecoveryTimer = window.setTimeout(() => {
        iceRecoveryTimer = undefined
        const pc = peerConnection
        if (!pc) return
        const state = pc.iceConnectionState
        if (state === 'connected' || state === 'completed') return
        void this._restartIce(pc)
      }, delay)
    },

    /** Перезапуск ICE: собираем адреса на новых интерфейсах и пересогласуем SDP. */
    async _restartIce(connection: RTCPeerConnection) {
      if (this.status !== 'active' || connection !== peerConnection) return
      if (iceRestartAttempts >= ICE_RESTART_MAX_ATTEMPTS) {
        this._forceEnd('Связь потеряна — звонок завершён')
        return
      }
      iceRestartAttempts += 1
      this.reconnecting = true
      try {
        const pc = connection as RTCPeerConnection & { restartIce?: () => void }
        pc.restartIce?.()
        const offer = await pc.createOffer({ iceRestart: true })
        await pc.setLocalDescription(offer)
        if (connection !== peerConnection || this.status !== 'active') return
        sendMessage({
          type: 'call-renegotiate',
          to_user_id: this.peerId ?? 0,
          call_id: this.callId ?? '',
          sdp: offer.sdp ?? ''
        })
      } catch {
        /* не получилось — попробуем ещё раз по таймеру */
      }
      this._scheduleIceRestart(ICE_RETRY_DELAY_MS)
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
          // Повторная доставка того же вызова (переподключение сокета, повторный
          // push из уведомления) — не начинаем звонок заново.
          if (callId && this.callId === callId && this.status !== 'idle') {
            // Интерфейсу нужно погасить возможное системное уведомление.
            this.ignoredCallOffers += 1
            break
          }
          if (this.status !== 'idle') {
            // Уже занят другим вызовом — автоматически отклоняем.
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
        case 'call-renegotiate': {
          // Собеседник меняет медиа (демонстрация экрана/смена устройства):
          // отвечаем своим SDP-ответом.
          if (!peerConnection || this.callId !== callId || !message.sdp) return
          void this._answerRenegotiate(message.sdp)
          break
        }
        case 'call-renegotiate-answer': {
          if (!peerConnection || this.callId !== callId || !message.sdp) return
          void peerConnection
            .setRemoteDescription({ type: 'answer', sdp: message.sdp })
            .catch(() => undefined)
          break
        }
        case 'call-rejoin': {
          // Собеседник перезагрузил страницу: у него новое соединение и новые
          // ICE-адреса, а его прежний SDP мёртв. Связь жива только у нас,
          // поэтому пересогласуемся заново: для него это выглядит как короткое
          // «Переподключаемся…», а не как сброшенный звонок.
          if (this.status !== 'active' || this.callId !== callId || !peerConnection) return
          iceRestartAttempts = 0
          void this._restartIce(peerConnection)
          break
        }
        case 'call-screen': {
          if (this.callId !== callId) return
          this.peerScreenSharing = Boolean(message.sharing)
          if (this.peerScreenSharing) {
            // Показ экрана включается как видео — переводим интерфейс в видео-режим,
            // чтобы было видно картинку собеседника (своя сторона уже это сделала).
            this.kind = 'video'
          } else if (!this.screenSharing && message.kind === 'audio') {
            // Собеседник показывал экран из аудиозвонка и закончил — возвращаемся
            // в аудио (если я сам сейчас ничего не показываю). Проверяем именно
            // 'audio': старый клиент поле не шлёт, и его режим менять нельзя.
            this.kind = 'audio'
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
        case 'call-parked': {
          // Абонент не в сети, но уведомление ушло — он может ответить,
          // открыв приложение (см. park_offer на бэкенде).
          this.notice = 'Собеседник не в сети — отправили уведомление о звонке'
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
        this._restoreSavedDevices()
        const ice = await loadIceConfiguration()
        const stream = await navigator.mediaDevices.getUserMedia(
          mediaConstraints(kind, this.selectedCamera, this.selectedMic)
        )
        localMedia = stream
        peerConnection = new RTCPeerConnection(ice)
        this._wirePeerConnection(peerConnection)
        stream.getTracks().forEach((track) => peerConnection?.addTrack(track, stream))

        isCaller = true
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
        void this.loadDevices()
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
        this._restoreSavedDevices()
        const ice = await loadIceConfiguration()
        const stream = await navigator.mediaDevices.getUserMedia(
          mediaConstraints(kind, this.selectedCamera, this.selectedMic)
        )
        localMedia = stream
        peerConnection = new RTCPeerConnection(ice)
        this._wirePeerConnection(peerConnection)
        stream.getTracks().forEach((track) => peerConnection?.addTrack(track, stream))
        await peerConnection.setRemoteDescription({ type: 'offer', sdp: pendingOffer.sdp })
        const answer = await peerConnection.createAnswer()
        await peerConnection.setLocalDescription(answer)
        isCaller = false
        this.kind = kind
        sendMessage({
          type: 'call-answer',
          to_user_id: this.peerId ?? 0,
          call_id: this.callId ?? '',
          sdp: answer.sdp ?? ''
        })
        this._becomeActive()
        void this.loadDevices()
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
        // Отмечаем звонок живым: перезагрузка должна поднимать свежий разговор,
        // а не только что начатый.
        if (this.seconds % CALL_TOUCH_EVERY_SECONDS === 0) this.rememberCall()
      }, 1000)
      // Режем битрейт видео, чтобы звонок стабильно шёл через TURN/мобильный.
      void this._capVideoBitrate()
      // Пока звонок идёт — помним о нём: перезагрузка страницы не должна его терять.
      this.rememberCall()
    },

    /** Запоминает звонок для восстановления после перезагрузки страницы. */
    rememberCall() {
      if (!this.callId || !this.peerId || this.status !== 'active') return
      rememberActiveCall({
        callId: this.callId,
        peerId: this.peerId,
        kind: this.kind,
        startedAt: Date.now() - this.seconds * 1000,
        touchedAt: Date.now()
      })
    },

    /**
     * Поднимает звонок заново после перезагрузки страницы.
     *
     * Перезагрузка убивает WebRTC: камера, микрофон и SDP жили в старой странице.
     * Собеседник этого не видит — его соединение остаётся живым, он просто
     * перестаёт слышать и видеть. Поэтому создаём новое соединение и просим
     * собеседника пересогласоваться, а сами отвечаем на его offer.
     */
    async recoverCallAfterReload(): Promise<boolean> {
      const stored = callAfterReload()
      if (!stored || this.status !== 'idle' || !this.connected) return false
      // Попытка одна: не выйдет — сообщим, что звонок завершён.
      forgetActiveCall()

      try {
        this._restoreSavedDevices()
        const ice = await loadIceConfiguration()
        const stream = await navigator.mediaDevices.getUserMedia(
          mediaConstraints(stored.kind, this.selectedCamera, this.selectedMic)
        )
        localMedia = stream
        peerConnection = new RTCPeerConnection(ice)
        this._wirePeerConnection(peerConnection)
        stream.getTracks().forEach((track) => peerConnection?.addTrack(track, stream))
        isCaller = false
        this.$patch({
          status: 'active',
          kind: stored.kind,
          callId: stored.callId,
          peerId: stored.peerId,
          micOn: true,
          videoOn: true
        })
        this._becomeActive()
        // Время разговора считаем от момента, когда звонок стал активным до
        // перезагрузки: счётчик не должен начинаться заново.
        this.seconds = Math.max(0, Math.round((Date.now() - stored.startedAt) / 1000))
        this.rememberCall()
        // Пока пересогласования нет, связи нет — показываем «Переподключаемся…».
        this.reconnecting = true
        sendMessage({
          type: 'call-rejoin',
          to_user_id: stored.peerId,
          call_id: stored.callId
        })
        this._armRejoinTimeout()
        void this.loadDevices()
        return true
      } catch {
        this._cleanup()
        this.notice = 'Звонок завершён: не удалось восстановить связь'
        return false
      }
    },

    /** Если собеседник не откликнулся на возврат — звонок действительно кончился. */
    _armRejoinTimeout() {
      if (rejoinTimer !== undefined) window.clearTimeout(rejoinTimer)
      rejoinTimer = window.setTimeout(() => {
        rejoinTimer = undefined
        if (this.status !== 'active' || !this.reconnecting) return
        const pc = peerConnection
        if (pc && (pc.iceConnectionState === 'connected' || pc.connectionState === 'connected')) {
          return
        }
        this._forceEnd('Собеседник недоступен — звонок завершён')
      }, CALL_REJOIN_TIMEOUT_MS)
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
      if (this.kind !== 'video' || this.screenSharing) return
      this.videoOn = !this.videoOn
      localMedia?.getVideoTracks().forEach((track) => {
        track.enabled = this.videoOn
      })
    },

    /** Подтягивает сохранённый выбор устройств (до первого getUserMedia). */
    _restoreSavedDevices() {
      const saved = readCallDevices()
      if (!this.selectedCamera) this.selectedCamera = saved.camera ?? ''
      if (!this.selectedMic) this.selectedMic = saved.mic ?? ''
      if (!this.selectedSpeaker) this.selectedSpeaker = saved.speaker ?? ''
    },

    /* ---------------- Демонстрация экрана ---------------- */

    /** Включить/выключить показ своего экрана собеседнику. */
    async toggleScreenShare() {
      if (this.status !== 'active') return
      if (this.screenSharing) {
        this.stopScreenShare()
        return
      }
      await this._startScreenShare()
    },

    async _startScreenShare() {
      if (!peerConnection || this.screenSharing) return
      const support = screenShareSupport()
      if (support !== 'ok') {
        // Причина может быть в http, в мобильном браузере или в самом браузере —
        // сообщаем конкретную, чтобы не гадать (см. screenShareSupport).
        this.notice = screenShareNotice(support)
        return
      }
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: SCREEN_CONSTRAINTS })
        const track = stream.getVideoTracks()[0]
        if (!track) return
        screenTrack = track
        // Кнопка «Остановить показ» в самом браузере (плашка Chrome/Safari).
        track.onended = () => this.stopScreenShare()

        const sender = peerConnection.getSenders().find((item) => item.track?.kind === 'video')
        // Каким был звонок до показа: видеозвонок вернёт камеру, аудиозвонок — уберёт
        // видеолинию и останется аудио (см. `kindAfterScreenShare`).
        shareReturnKind = kindAfterScreenShare(this.kind)
        if (sender) {
          // Видеозвонок: подменяем дорожку без пересогласования.
          await sender.replaceTrack(track)
          screenSender = sender
        } else {
          // Аудиозвонок: добавляем видео-линию — нужен новый SDP.
          screenSender = peerConnection.addTrack(track, stream)
          await this._renegotiate()
        }
        // Гасим камеру на время показа (вернём при остановке) и показываем экран в превью.
        localMedia?.getVideoTracks().forEach((camera) => {
          camera.stop()
          localMedia?.removeTrack(camera)
        })
        if (!localMedia) localMedia = new MediaStream()
        localMedia.addTrack(track)
        this.screenSharing = true
        this.videoOn = true
        // Интерфейс становится видео-режимом: видно превью экрана и картинку собеседника.
        this.kind = 'video'
        this._sendScreenStatus(true)
        void this._capVideoBitrate()
      } catch {
        // Отказ от выбора окна в диалоге браузера — не ошибка.
        screenTrack = null
        this.notice = ''
      }
    },

    /** Останавливает показ экрана и возвращает звонок к прежнему виду. */
    stopScreenShare() {
      const track = screenTrack
      const sender =
        screenSender ??
        peerConnection?.getSenders().find((item) => item.track?.kind === 'video') ??
        null
      screenTrack = null
      screenSender = null
      if (track) {
        track.onended = null
        track.stop()
      }
      if (!this.screenSharing) return
      this.screenSharing = false
      if (track && localMedia) {
        localMedia.removeTrack(track)
      }
      if (shareReturnKind === 'audio') {
        // Звонок был аудио — камеру НЕ включаем: убираем видео-линию и
        // возвращаемся в аудио (интерфейс и у собеседника тоже).
        this.kind = 'audio'
        this.videoOn = false
        void this._dropVideoLine(sender)
        this._sendScreenStatus(false)
        return
      }
      void this._restoreCamera(sender)
      this._sendScreenStatus(false)
    },

    /**
     * Убирает видео-линию из соединения (после показа экрана в аудиозвонке).
     * Пересогласование не нужно: `replaceTrack(null)` просто перестаёт отправлять
     * видео, а m-line остаётся неиспользуемой до конца звонка.
     */
    async _dropVideoLine(sender: RTCRtpSender | null): Promise<void> {
      if (!sender) return
      try {
        await sender.replaceTrack(null)
      } catch {
        /* соединение уже закрывается — не мешаем */
      }
    },

    /** Возвращает камеру после показа экрана (или отключает видео-линию, если не удалось). */
    async _restoreCamera(sender: RTCRtpSender | null) {
      if (!peerConnection) return
      const target =
        sender ?? peerConnection.getSenders().find((item) => item.track?.kind === 'video')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: this._videoConstraints()
        })
        const track = stream.getVideoTracks()[0]
        if (!track) throw new Error('нет видеодорожки')
        swapTrackInStream(localMedia, track, 'video')
        track.enabled = this.videoOn
        if (target) await target.replaceTrack(track)
        else peerConnection.addTrack(track, localMedia ?? new MediaStream([track]))
      } catch {
        // Камера недоступна — просто перестаём отправлять видео, звонок продолжается.
        if (target) await target.replaceTrack(null).catch(() => undefined)
        this.videoOn = false
      }
    },

    _sendScreenStatus(sharing: boolean) {
      sendMessage({
        type: 'call-screen',
        to_user_id: this.peerId ?? 0,
        call_id: this.callId ?? '',
        sharing,
        // В каком режиме продолжается звонок: собеседник вернёт аудио-интерфейс,
        // если показ экрана закончился в аудиозвонке.
        kind: sharing ? 'video' : this.kind
      })
    },

    /** Ответ на пересогласование от собеседника. */
    async _answerRenegotiate(sdp: string) {
      if (!peerConnection) return
      try {
        await peerConnection.setRemoteDescription({ type: 'offer', sdp })
        const answer = await peerConnection.createAnswer()
        await peerConnection.setLocalDescription(answer)
        sendMessage({
          type: 'call-renegotiate-answer',
          to_user_id: this.peerId ?? 0,
          call_id: this.callId ?? '',
          sdp: answer.sdp ?? ''
        })
      } catch {
        /* пересогласование не удалось — звонок продолжается как есть */
      }
    },

    /** Инициирует пересогласование SDP (после добавления видео-линии). */
    async _renegotiate() {
      if (!peerConnection) return
      const seq = ++renegotiateSeq
      try {
        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        if (seq !== renegotiateSeq) return
        sendMessage({
          type: 'call-renegotiate',
          to_user_id: this.peerId ?? 0,
          call_id: this.callId ?? '',
          sdp: offer.sdp ?? ''
        })
      } catch {
        /* без пересогласования видео не появится, но звонок жив */
      }
    },

    /* ---------------- Устройства (камера/микрофон/динамик) ---------------- */

    /** Обновляет список устройств (после разрешения доступа имена не пустые). */
    async loadDevices() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
      try {
        const list = await navigator.mediaDevices.enumerateDevices()
        const grouped = groupDevices(list)
        const saved = readCallDevices()
        this.cameras = grouped.cameras
        this.microphones = grouped.microphones
        this.speakers = grouped.speakers
        this.selectedCamera = chooseDeviceId(grouped.cameras, this.selectedCamera || saved.camera)
        this.selectedMic = chooseDeviceId(grouped.microphones, this.selectedMic || saved.mic)
        this.selectedSpeaker = chooseDeviceId(
          grouped.speakers,
          this.selectedSpeaker || saved.speaker
        )
      } catch {
        /* список устройств недоступен — остаются системные по умолчанию */
      }
    },

    _videoConstraints(): MediaTrackConstraints {
      const constraints: MediaTrackConstraints = { ...VIDEO_CONSTRAINTS }
      if (this.selectedCamera) constraints.deviceId = { exact: this.selectedCamera }
      return constraints
    },

    /** Сменить камеру по ходу звонка (готовим превью без перезапуска звонка). */
    async setCameraDevice(deviceId: string) {
      this.selectedCamera = deviceId
      writeCallDevices({ camera: deviceId })
      if (this.status !== 'active' || this.screenSharing || this.kind !== 'video') return
      const sender = peerConnection?.getSenders().find((item) => item.track?.kind === 'video')
      if (!sender || !peerConnection) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: this._videoConstraints()
        })
        const track = stream.getVideoTracks()[0]
        if (!track) return
        localMedia?.getVideoTracks().forEach((old) => {
          old.stop()
          localMedia?.removeTrack(old)
        })
        if (!localMedia) localMedia = new MediaStream()
        localMedia.addTrack(track)
        track.enabled = this.videoOn
        await sender.replaceTrack(track)
      } catch {
        this.notice = 'Не удалось переключить камеру'
      }
    },

    /** Сменить микрофон по ходу звонка. */
    async setMicDevice(deviceId: string) {
      this.selectedMic = deviceId
      writeCallDevices({ mic: deviceId })
      if (this.status !== 'active') return
      const sender = peerConnection?.getSenders().find((item) => item.track?.kind === 'audio')
      if (!sender) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } }
        })
        const track = stream.getAudioTracks()[0]
        if (!track) return
        localMedia?.getAudioTracks().forEach((old) => {
          old.stop()
          localMedia?.removeTrack(old)
        })
        if (!localMedia) localMedia = new MediaStream()
        localMedia.addTrack(track)
        track.enabled = this.micOn
        await sender.replaceTrack(track)
      } catch {
        this.notice = 'Не удалось переключить микрофон'
      }
    },

    /** Выбрать динамик (применит интерфейс через setSinkId, если браузер умеет). */
    setSpeakerDevice(deviceId: string) {
      this.selectedSpeaker = deviceId
      writeCallDevices({ speaker: deviceId })
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
      // Остановка показа экрана не должна дёргать getUserMedia для камеры:
      // звонок уже завершается, поэтому просто гасим дорожку.
      if (screenTrack) {
        screenTrack.onended = null
        screenTrack.stop()
        screenTrack = null
      }
      screenSender = null
      shareReturnKind = 'video'
      renegotiateSeq += 1
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
      if (iceRecoveryTimer !== undefined) {
        window.clearTimeout(iceRecoveryTimer)
        iceRecoveryTimer = undefined
      }
      if (rejoinTimer !== undefined) {
        window.clearTimeout(rejoinTimer)
        rejoinTimer = undefined
      }
      if (socketRetryTimer !== undefined) {
        window.clearTimeout(socketRetryTimer)
        socketRetryTimer = undefined
      }
      iceRestartAttempts = 0
      socketRetryDeadline = 0
      isCaller = false
      // Звонок завершён осознанно — поднимать его после перезагрузки не нужно.
      forgetActiveCall()
      this.$patch({ ...DEFAULT_STATE, connected: this.connected })
    },

    _wirePeerConnection(connection: RTCPeerConnection) {
      // Смена сети: следим за состоянием ICE и при необходимости перезапускаем.
      connection.oniceconnectionstatechange = () => this._handleIceState(connection)
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'connected' && this.status === 'outgoing') {
          // Собеседник принял звонок: подтверждение могло не дойти — доводим
          // состояние по факту соединения.
          this._becomeActive()
        }
      }
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
