import { defineStore } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { kindAfterScreenShare } from '@/utils/callMode'
import {
  collectDiagnostics,
  connectionQuality as qualityOf,
  diagnosticsSummary as summaryOf,
  type CallDiagnostics,
  type ConnectionQuality,
  type StatsSample
} from '@/utils/callStats'
import {
  chooseDeviceId,
  groupDevices,
  readCallDevices,
  writeCallDevices
} from '@/utils/callDevices'

import { screenShareNotice, screenShareSupport } from './call/screenShare'
import {
  ANSWER_RETRY_MAX_ATTEMPTS,
  ANSWER_RETRY_MS,
  ICE_DISCONNECTED_GRACE_MS,
  ICE_RESTART_MAX_ATTEMPTS,
  ICE_RETRY_DELAY_MS,
  INCOMING_STALE_TIMEOUT_MS,
  LINK_RECOVERY_WINDOW_MS,
  LINK_RETRY_MS,
  MEDIA_WATCHDOG_FAILURES_BEFORE_RESTART,
  MEDIA_WATCHDOG_INTERVAL_MS,
  MEDIA_WATCHDOG_MAX_RESTARTS,
  RING_OUT_TIMEOUT_MS,
  STATS_POLL_INTERVAL_MS
} from './call/constants'
import {
  AUDIO_CONSTRAINTS,
  SCREEN_CONSTRAINTS,
  VIDEO_CONSTRAINTS,
  loadIceConfiguration,
  mediaConstraints,
  mediaErrorMessage,
  remoteMediaFlowing,
  setRelayOnly,
  socketUrl,
  stopAllTracks,
  swapTrackInStream
} from './call/media'
import {
  ensureCallOutput,
  remoteOutputReady,
  setRemoteOutputVolume,
  teardownCallOutput,
  wireRemoteOutput
} from './call/output'
import { startRingtone, stopRingtone } from './call/ringtone'
import {
  CALL_REJOIN_TIMEOUT_MS,
  CALL_TOUCH_EVERY_SECONDS,
  callAfterReload,
  forgetActiveCall,
  rememberActiveCall
} from './call/session'
import type { CallKind, CallPeer, CallStatus, SignalingMessage } from './call/types'

// Публичный контракт стора звонков остаётся прежним: всё это по-прежнему
// импортируется из `@/stores/call`, хотя живёт в соседних модулях `stores/call/`.
export { screenShareNotice, screenShareSupport } from './call/screenShare'
export type { CallKind, CallPeer, CallStatus, ScreenShareSupport } from './call/types'

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

/** Сторож входящего звонка: вызов давно не звонит, а мы об этом не узнали. */
let incomingTimer: number | undefined
/** До какого момента входящий звонок ещё имеет смысл ждать (см. сторож). */
let incomingDeadline = 0
/** Отсчёт до «собеседник так и не вернулся» после перезагрузки страницы. */
let rejoinTimer: number | undefined
/* Восстановление связи при смене сети (Wi-Fi → LTE и обратно). */
let iceRecoveryTimer: number | undefined
let iceRestartAttempts = 0
let socketRetryTimer: number | undefined
let socketRetryDeadline = 0
/** Инициатор звонка: он перезапускает ICE первым, отвечающий — с задержкой. */
let isCaller = false
/**
 * Наш SDP-ответ: нужен, чтобы повторить ответ собеседнику, если тот его не
 * получил (см. `_armAnswerRetry`).
 */
let lastAnswerSdp: string | null = null
let answerRetryTimer: number | undefined
let answerRetryAttempts = 0
/* Наблюдатель за медиа: звонок «установлен», но звук/видео так и не пришли. */
let mediaWatchdogTimer: ReturnType<typeof setInterval> | undefined
let mediaWatchdogFailures = 0
let mediaWatchdogRestarts = 0
let mediaWatchdogBusy = false
/** Перезапуск ICE уже идёт: второй не нужен (иначе счётчик попыток сгорит). */
let iceRestartInFlight = false
/* Статистика соединения: опрос раз в несколько секунд (качество + диагностика). */
let statsTimer: number | undefined
let statsSample: StatsSample | null = null
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
  /** Микрофон собеседника (по его сигналу `call-media-state`). */
  peerMicOn: boolean
  /** Идёт ли видео от собеседника (камера или показ экрана). */
  peerVideoOn: boolean
  /** Последняя снятая статистика соединения (качество связи и диагностика). */
  diagnostics: CallDiagnostics | null
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
  ringOutTimer: number | undefined
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
  peerMicOn: true,
  peerVideoOn: true,
  diagnostics: null,
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

function sendMessage(message: SignalingMessage): boolean {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
    return true
  }
  return false
}

export const useCallStore = defineStore('call', {
  state: (): CallState => ({ ...DEFAULT_STATE }),

  getters: {
    isBusy: (state) => state.status === 'active' || state.status === 'outgoing',
    /** Можно ли переключать камеру/микрофон по ходу звонка. */
    canSwitchDevices: (state) => state.status === 'active',
    /** Качество связи для индикатора («Плохая связь»). */
    connectionQuality: (state): ConnectionQuality => qualityOf(state.diagnostics),
    /** Короткая расшифровка диагностики (для панели и подписи). */
    diagnosticsSummary: (state): string => summaryOf(state.diagnostics),
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
          // Отвечающая сторона: повторяем ответ — пока канал был закрыт, он мог
          // «уйти в никуда», и зовущий всё ещё звонит.
          if (this.status === 'active' && !isCaller) this._resendAnswer()
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
      // Медиа пошло — значит ответ дошёл, повторять его больше не нужно.
      this._clearAnswerRetry()
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

    /**
     * Наблюдает за медиа после установления звонка: соединение может числиться
     * установленным, а звука/видео не будет (чёрный экран, тишина).
     */
    _armMediaWatchdog() {
      this._clearMediaWatchdog()
      if (this.status !== 'active' || typeof window === 'undefined') return
      mediaWatchdogRestarts = 0
      mediaWatchdogTimer = window.setInterval(() => {
        void this._checkMediaFlow()
      }, MEDIA_WATCHDOG_INTERVAL_MS)
    },

    _clearMediaWatchdog() {
      if (mediaWatchdogTimer !== undefined) {
        window.clearInterval(mediaWatchdogTimer)
        mediaWatchdogTimer = undefined
      }
      mediaWatchdogFailures = 0
    },

    /**
     * Проверяет, идёт ли от собеседника медиа, и чинит соединение сам.
     *
     * Это автоматическая замена ручного «переключить Wi-Fi↔LTE»: если ICE/DTLS
     * считаются установленными, а пакеты не идут, перезапускаем ICE. Если медиа
     * уже идёт — наблюдатель выключается (своё дело сделал).
     */
    async _checkMediaFlow() {
      if (this.status !== 'active' || mediaWatchdogBusy) return
      const pc = peerConnection
      if (!pc) {
        this._clearMediaWatchdog()
        return
      }
      mediaWatchdogBusy = true
      const flowing = await (async () => {
        try {
          return await remoteMediaFlowing(pc)
        } finally {
          mediaWatchdogBusy = false
        }
      })()
      // Пока читали статистику, звонок мог закончиться или соединение — замениться.
      if (this.status !== 'active' || pc !== peerConnection) return
      if (flowing) {
        // Медиа пошло. Если для этого не понадобилось ни одного перезапуска —
        // сеть в порядке, снимаем пометку «в прошлый раз помогал только релей».
        if (mediaWatchdogRestarts === 0) setRelayOnly(false)
        this._clearMediaWatchdog()
        return
      }
      mediaWatchdogFailures += 1
      // Зовущий ждёт меньше, отвечающий — дольше: иначе два одновременных
      // пересогласования SDP столкнутся (glare) и оба сорвутся.
      const failuresNeeded = isCaller
        ? MEDIA_WATCHDOG_FAILURES_BEFORE_RESTART
        : MEDIA_WATCHDOG_FAILURES_BEFORE_RESTART + 1
      if (mediaWatchdogFailures < failuresNeeded) return
      mediaWatchdogFailures = 0
      if (mediaWatchdogRestarts >= MEDIA_WATCHDOG_MAX_RESTARTS) {
        // Сами не починили — дальше только предупреждаем, звонок не рвём.
        this._clearMediaWatchdog()
        this.notice = 'Звук и видео не идут — попробуйте переключить сеть или перезвонить'
        return
      }
      mediaWatchdogRestarts += 1
      // Напрямую не выходит: в следующий раз начнём сразу через TURN-релей
      // (смена сети помогала именно потому, что заново поднимался ICE).
      if (mediaWatchdogRestarts >= 2) setRelayOnly(true)
      this.reconnecting = true
      await this._restartIce(pc)
    },

    /** Перезапуск ICE: собираем адреса на новых интерфейсах и пересогласуем SDP. */
    async _restartIce(connection: RTCPeerConnection) {
      if (this.status !== 'active' || connection !== peerConnection) return
      // Перезапуск уже идёт: второй только сожжёт попытки (см. наблюдатель медиа).
      if (iceRestartInFlight) return
      if (iceRestartAttempts >= ICE_RESTART_MAX_ATTEMPTS) {
        this._forceEnd('Связь потеряна — звонок завершён')
        return
      }
      iceRestartInFlight = true
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
      } finally {
        iceRestartInFlight = false
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

    /**
     * Отпускает сигнальный канал при уходе страницы (перезагрузка, закрытие).
     *
     * Состояние звонка НЕ трогаем: при перезагрузке оно поднимается заново
     * (см. `recoverCallAfterReload`). А вот старый сокет закрываем сразу: у
     * человека соединений может быть несколько (телефон, вкладка), и уходящая
     * страница не должна продолжать получать сигналинг за второе устройство.
     */
    detachSignaling() {
      if (!socket) return
      socket.onclose = null
      socket.close()
      socket = null
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
          // Страховка на случай, когда о завершении вызова нам не сообщили
          // (например, приложение было закрыто, а звонок приняли на другом
          // устройстве). Иначе «входящий» висел бы бесконечно и следующий
          // звонок автоматически отклонялся бы как «занят».
          this._armIncomingTimer()
          break
        }
        case 'call-answer': {
          if (this.status === 'outgoing' && this.callId === callId && peerConnection) {
            if (message.sdp) {
              // Повторный ответ (страховка отвечающей стороны) не должен ронять
              // обработку: первый уже применён, второй просто игнорируем.
              void peerConnection
                .setRemoteDescription({ type: 'answer', sdp: message.sdp })
                .catch(() => undefined)
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
            this.notice =
              message.reason === 'busy'
                ? 'Абонент занят'
                : message.reason === 'failed'
                  ? 'Собеседник не смог ответить'
                  : 'Абонент отклонил звонок'
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
        case 'call-ended-elsewhere': {
          // Тот же звонок приняли или отклонили на другом устройстве этого же
          // человека (звонок звонит сразу на все его устройства).
          if (this.callId !== callId) return
          if (this.status !== 'incoming' && this.status !== 'outgoing') return
          this._cleanup()
          // Причину передаёт сервер: «ответить не удалось» (нет микрофона или
          // камеры) и «уже занят» — не «отклонил», и врать на втором устройстве
          // этого же человека нельзя.
          const elsewhere: Record<string, string> = {
            answered: 'Звонок принят на другом устройстве',
            failed: 'На другом устройстве не удалось ответить',
            busy: 'На другом устройстве уже идёт звонок'
          }
          this.notice = elsewhere[String(message.reason)] ?? 'Звонок отклонён на другом устройстве'
          break
        }
        case 'call-media-state': {
          // Собеседник выключил микрофон/камеру: показываем это в интерфейсе,
          // чтобы чёрный экран не выглядел поломкой.
          if (this.callId !== callId) return
          this.peerMicOn = message.mic_on !== false
          this.peerVideoOn = message.video_on !== false
          break
        }
        case 'call-parked': {
          // Абонент не в сети: вызов ждёт его в приложении и будет доставлен,
          // как только он туда зайдёт (см. park_offer на бэкенде). Уведомление
          // уходит, только если у него включены push-уведомления.
          this.notice =
            message.notified === false
              ? 'Собеседник не в сети без уведомлений — звонок ждёт его в приложении'
              : 'Собеседник не в сети — отправили уведомление о звонке'
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
      } catch (error) {
        this._cleanup()
        this.notice = mediaErrorMessage(error, kind)
      }
    },

    /** Принять входящий звонок. */
    async acceptCall() {
      if (this.status !== 'incoming' || !pendingOffer) return
      stopRingtone()
      // Контекст вывода создаём в жесте пользователя (иначе аудио заглушится).
      ensureCallOutput()
      const kind = pendingOffer.kind
      const offerSdp = pendingOffer.sdp
      // Собеседник и вызов нужны и после `_cleanup()` — сохраняем заранее.
      const peerId = this.peerId ?? 0
      const callId = this.callId ?? ''
      // Сигнальный канал мог отвалиться, пока звонил телефон (фон, смена сети).
      // Поднимаем его заранее: иначе ответ молча уйдёт «в никуда» и у зовущего
      // звонок продолжит звонить, хотя мы уже нажали «Ответить».
      const connected = await this.connect()
      if (!connected) {
        this._cleanup()
        this.notice = 'Не удалось ответить: нет связи с сервером'
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
        await peerConnection.setRemoteDescription({ type: 'offer', sdp: offerSdp })
        const answer = await peerConnection.createAnswer()
        await peerConnection.setLocalDescription(answer)
        isCaller = false
        this.kind = kind
        lastAnswerSdp = answer.sdp ?? null
        sendMessage({
          type: 'call-answer',
          to_user_id: peerId,
          call_id: callId,
          sdp: answer.sdp ?? ''
        })
        this._becomeActive()
        // Ответ мог не дойти — повторяем, пока не поднимется медиа.
        this._armAnswerRetry()
        void this.loadDevices()
      } catch (error) {
        this._cleanup()
        // Сообщаем зовущему отказ: без этого у него звонок идёт до таймаута,
        // хотя ответить мы не смогли (нет доступа к камере/микрофону).
        this._declineUnanswered(peerId, callId)
        this.notice = mediaErrorMessage(error, kind)
      }
    },

    /**
     * Отправляет сигналинг, при необходимости поднимая сигнальный канал.
     *
     * Без этого важные сообщения (ответ на звонок, отказ, сброс) молча терялись,
     * если сокет в этот момент был закрыт: телефон вышел из фона, сменилась сеть.
     * Тогда у одной стороны звонок уже завершён, а у другой всё ещё звонит.
     */
    async _sendSignaling(message: SignalingMessage): Promise<boolean> {
      if (sendMessage(message)) return true
      if (await this.connect()) return sendMessage(message)
      return false
    },

    /**
     * Сообщает зовущему, что ответить не вышло.
     *
     * Вызывается после `_cleanup()` (состояние звонка уже не наше), поэтому
     * собеседник и call_id передаются явно. `reason`: 'failed' — принять не
     * получилось (нет доступа к камере/микрофону), 'declined' — человек отклонил.
     */
    _declineUnanswered(peerId: number, callId: string, reason = 'failed') {
      if (!peerId || !callId) return
      void this._sendSignaling({
        type: 'call-decline',
        to_user_id: peerId,
        call_id: callId,
        reason
      })
    },

    /**
     * Повторяет ответ собеседнику, пока медиа не поднялось.
     *
     * Зовущий мог не получить ответ (короткий обрыв его канала, перезапуск
     * сервера) и продолжает звонить, хотя мы уже разговариваем. Повторный ответ
     * безвреден: зовущий применяет его, только пока сам ждёт ответа.
     */
    _armAnswerRetry() {
      this._clearAnswerRetry()
      const tick = () => {
        answerRetryTimer = undefined
        const pc = peerConnection
        if (!pc || isCaller || this.status !== 'active' || !lastAnswerSdp) return
        if (
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed' ||
          pc.connectionState === 'connected'
        ) {
          return
        }
        if (answerRetryAttempts >= ANSWER_RETRY_MAX_ATTEMPTS) return
        answerRetryAttempts += 1
        this._resendAnswer()
        answerRetryTimer = window.setTimeout(tick, ANSWER_RETRY_MS)
      }
      answerRetryTimer = window.setTimeout(tick, ANSWER_RETRY_MS)
    },

    /** Отправляет сохранённый ответ ещё раз (см. `_armAnswerRetry`). */
    _resendAnswer() {
      if (isCaller || !lastAnswerSdp || this.status !== 'active') return
      sendMessage({
        type: 'call-answer',
        to_user_id: this.peerId ?? 0,
        call_id: this.callId ?? '',
        sdp: lastAnswerSdp
      })
    },

    _clearAnswerRetry() {
      if (answerRetryTimer !== undefined) {
        window.clearTimeout(answerRetryTimer)
        answerRetryTimer = undefined
      }
      answerRetryAttempts = 0
    },

    /** Отклонить входящий звонок. */
    declineCall() {
      if (this.status !== 'incoming') return
      const peerId = this.peerId ?? 0
      const callId = this.callId ?? ''
      this._cleanup()
      // Канал мог отвалиться, пока звонил телефон: тогда зовущий иначе «звонит»
      // до таймаута и в истории остаётся пропущенный вместо отказа.
      this._declineUnanswered(peerId, callId, 'declined')
    },

    /**
     * Звонок завершён, пока мы его не видели.
     *
     * Приходит тихим push'ом (см. `send_call_cancelled_push`): звонок приняли на
     * другом устройстве, отклонили или зовущий снял вызов, а наш сигнальный
     * канал в это время не работал. Если мы ещё «звоним» — прекращаем; если
     * разговор идёт, ничего не делаем (это наш вызов, и его гасить нельзя).
     */
    finishIfRinging(callId: string) {
      if (!callId || this.callId !== callId) return
      if (this.status !== 'incoming' && this.status !== 'outgoing') return
      this._cleanup()
      this.notice = 'Звонок завершён'
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
      this._cleanup()
      this._declineUnanswered(peerId, callId, 'declined')
    },

    /** Отменить исходящий звонок до ответа. */
    cancelCall() {
      if (this.status !== 'outgoing') return
      const peerId = this.peerId ?? 0
      const callId = this.callId ?? ''
      this._cleanup()
      // Без гарантированной отправки собеседник продолжал бы звонить в тишине.
      void this._sendSignaling({ type: 'call-cancel', to_user_id: peerId, call_id: callId })
    },

    /** Завершить активный звонок. */
    endCall() {
      if (this.status === 'idle') return
      const peerId = this.peerId ?? 0
      const callId = this.callId ?? ''
      this._cleanup()
      void this._sendSignaling({ type: 'call-end', to_user_id: peerId, call_id: callId })
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
      // Проверяем, что медиа действительно пошло (иначе чёрный экран и тишина,
      // а «лечится» это перезапуском ICE).
      this._armMediaWatchdog()
      // Собеседнику сразу сообщаем своё состояние микрофона/камеры, а себе берём
      // статистику соединения (индикатор качества и панель диагностики).
      this._sendMediaState()
      this._startStatsPolling()
    },

    /** Сообщает собеседнику состояние своего микрофона и камеры. */
    _sendMediaState() {
      if (this.status !== 'active' || !this.callId) return
      sendMessage({
        type: 'call-media-state',
        to_user_id: this.peerId ?? 0,
        call_id: this.callId,
        mic_on: this.micOn,
        // Показ экрана тоже идёт как видео — для собеседника картинка есть.
        video_on: this.videoOn || this.screenSharing
      })
    },

    /**
     * Снимает статистику соединения: качество связи и данные для диагностики.
     * Зовётся и по таймеру, и вручную из панели «Диагностика звонка».
     */
    async refreshDiagnostics(): Promise<void> {
      const pc = peerConnection
      if (!pc || typeof pc.getStats !== 'function') return
      try {
        const report = await pc.getStats()
        const { diagnostics, sample } = collectDiagnostics(report, pc, statsSample)
        statsSample = sample
        this.diagnostics = diagnostics
      } catch {
        /* статистика может быть недоступна — звонку не мешаем */
      }
    },

    _startStatsPolling() {
      this._clearStatsPolling()
      statsSample = null
      void this.refreshDiagnostics()
      statsTimer = window.setInterval(() => {
        void this.refreshDiagnostics()
      }, STATS_POLL_INTERVAL_MS)
    },

    _clearStatsPolling() {
      if (statsTimer !== undefined) {
        window.clearInterval(statsTimer)
        statsTimer = undefined
      }
      statsSample = null
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
      return remoteOutputReady()
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
      // Собеседник должен видеть, что нас не слышно (а не думать, что сломалось).
      this._sendMediaState()
    },

    /** Переключить камеру. */
    toggleCamera() {
      if (this.kind !== 'video' || this.screenSharing) return
      this.videoOn = !this.videoOn
      localMedia?.getVideoTracks().forEach((track) => {
        track.enabled = this.videoOn
      })
      this._sendMediaState()
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
        this._sendMediaState()
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
        this._sendMediaState()
        return
      }
      void this._restoreCamera(sender)
      this._sendScreenStatus(false)
      this._sendMediaState()
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

    /** Сторож входящего звонка (см. `INCOMING_STALE_TIMEOUT_MS`). */
    _armIncomingTimer() {
      this._clearIncomingTimer()
      incomingDeadline = Date.now() + INCOMING_STALE_TIMEOUT_MS
      incomingTimer = window.setTimeout(() => {
        incomingTimer = undefined
        this.dropStaleRinging()
      }, INCOMING_STALE_TIMEOUT_MS)
    },

    _clearIncomingTimer() {
      incomingDeadline = 0
      if (incomingTimer !== undefined) {
        window.clearTimeout(incomingTimer)
        incomingTimer = undefined
      }
    },

    /**
     * Погасить «звонок», который звонит слишком долго.
     *
     * О завершении вызова нам могли не сообщить (канал отвалился, приложение
     * было в фоне), и тогда окно вызова со звуком висит бесконечно. Помимо
     * таймера проверяем это и при возврате на экран: в свёрнутой вкладке
     * браузер душит таймеры, и до «просыпания» сторож просто не срабатывает.
     *
     * Отказ не отправляем: вызов на сервере уже разобран, а «отклонил»
     * записался бы в историю как реальный отказ.
     */
    dropStaleRinging(): boolean {
      if (this.status !== 'incoming') return false
      if (!incomingDeadline || Date.now() < incomingDeadline) return false
      this._cleanup()
      this.notice = 'Звонок завершён'
      return true
    },

    /** Принудительно завершает звонок (обрыв соединения и т.п.). */
    _forceEnd(message: string) {
      this._cleanup()
      this.notice = message
    },

    _cleanup() {
      stopRingtone()
      this._clearRingOutTimer()
      this._clearIncomingTimer()
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
      lastAnswerSdp = null
      iceRestartInFlight = false
      mediaWatchdogRestarts = 0
      this._clearAnswerRetry()
      this._clearMediaWatchdog()
      this._clearStatsPolling()
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
