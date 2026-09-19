import { defineStore } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { kindAfterScreenShare } from '@/utils/callMode'
import {
  collectDiagnostics,
  connectionQuality as qualityOf,
  diagnosticsSummary as summaryOf,
  speakingNow,
  worstQuality,
  type CallDiagnostics,
  type ConnectionQuality
} from '@/utils/callStats'
import {
  callRoute,
  callVerificationCode,
  routeHint,
  routeLabel,
  type CallRoute
} from '@/utils/callVerification'
import {
  chooseDeviceId,
  groupDevices,
  readCallDevices,
  writeCallDevices,
  type MicProcessing
} from '@/utils/callDevices'

import {
  applyTrackHints,
  initialSenderTuning,
  jitterTargetsFor,
  qualityStepFor,
  resolveStep,
  senderTuningForStep,
  shouldPauseForQuality,
  tuneReceivers,
  tuneSenders,
  tunedDescription,
  videoStepFor,
  type QualityStep
} from './call/quality'
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
  MAX_GROUP_PARTICIPANTS,
  OFFER_MAX_ATTEMPTS,
  OFFER_RETRY_MS,
  MEDIA_WATCHDOG_FAILURES_BEFORE_RESTART,
  MEDIA_WATCHDOG_INTERVAL_MS,
  MEDIA_WATCHDOG_MAX_RESTARTS,
  QUALITY_STEP_COOLDOWN_MS,
  RING_OUT_TIMEOUT_MS,
  SPEAKING_POLL_INTERVAL_MS,
  STATS_POLL_INTERVAL_MS,
  VIDEO_PAUSE_BAD_POLLS,
  VIDEO_RESUME_GOOD_POLLS
} from './call/constants'
import {
  GROUP_VIDEO_CONSTRAINTS,
  SCREEN_CONSTRAINTS,
  VIDEO_CONSTRAINTS,
  acquireCameraStream,
  acquireLocalMedia,
  audioConstraints,
  hasLiveTrack,
  loadIceConfiguration,
  mediaErrorMessage,
  remoteMediaFlowing,
  setRelayOnly,
  socketUrl,
  stopAllTracks,
  swapTrackInStream
} from './call/media'
import {
  ensureCallOutput,
  remoteLevels,
  remoteOutputReady,
  setRemoteOutputVolume,
  teardownCallOutput,
  unwireRemoteOutput,
  wireRemoteOutput
} from './call/output'
import { startRingtone, stopRingtone } from './call/ringtone'
import { runtime, sendRuntimeMessage } from './call/signaling'
import type { PeerLink } from './call/signaling'
import {
  CALL_REJOIN_TIMEOUT_MS,
  CALL_TOUCH_EVERY_SECONDS,
  callAfterReload,
  forgetActiveCall,
  rememberActiveCall
} from './call/session'
import type {
  CallKind,
  CallParticipant,
  CallPeer,
  CallStatus,
  SignalingMessage
} from './call/types'

// Публичный контракт стора звонков остаётся прежним: всё это по-прежнему
// импортируется из `@/stores/call`, хотя живёт в соседних модулях `stores/call/`.
export { screenShareNotice, screenShareSupport } from './call/screenShare'
// Строка о связи с участником — для панели диагностики группового звонка.
export { peerQualityLine } from './call/quality'
export type { CallKind, CallPeer, CallStatus, ScreenShareSupport } from './call/types'
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
  /**
   * Видео приостановлено из-за плохой связи (автоматически, для звука).
   *
   * Состояние показываем в интерфейсе и сообщаем собеседнику как «камера
   * выключена», иначе он видел бы «сломанную» картинку.
   */
  videoPausedForNetwork: boolean
  /** Режим обработки микрофона: шумодав («чистый голос») или естественный звук. */
  micProcessing: MicProcessing
  /** Микрофон собеседника (по его сигналу `call-media-state`). */
  peerMicOn: boolean
  /** Идёт ли видео от собеседника (камера или показ экрана). */
  peerVideoOn: boolean
  /** Последняя снятая статистика соединения (качество связи и диагностика). */
  diagnostics: CallDiagnostics | null
  /**
   * Статистика по КАЖДОМУ участнику (только для интерфейса).
   *
   * В групповом звонке «плохо слышно» относится к конкретному собеседнику, а не
   * к звонку целиком: в панели диагностики показываем связь с каждым, а бейдж
   * «Плохая связь» загорается по худшей из связей.
   */
  peerDiagnostics: Record<number, CallDiagnostics>
  /** Теряли связь и восстанавливаем (смена сети): показываем «Переподключаемся…». */
  reconnecting: boolean
  /** Собеседник показывает экран. */
  peerScreenSharing: boolean
  /**
   * Код сверки звонка: его считают оба участника из отпечатков сертификатов
   * DTLS-SRTP и сравнивают вслух (см. `utils/callVerification.ts`). Пусто —
   * соединение ещё не установилось, сверять нечего.
   */
  verificationCode: string
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
  /** Групповой звонок «mesh»: участников может быть до четырёх. */
  isGroup: boolean
  /** id группового чата (для сигналинга и подписи). */
  groupChatId: number | null
  /** Участники группового звонка (в 1:1 — один, собеседник). */
  participants: CallParticipant[]
  /**
   * Запомненные имена участников (id → имя и аватар).
   *
   * Состав звонка сервер отдаёт только идентификаторами (`call-peers`), поэтому
   * без этой памяти в плитках появлялись «@29» вместо «Сергей». Наполняет
   * `Messenger` — он знает участников чата.
   */
  peerNames: Record<number, { name: string; avatarUrl?: string | null }>
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
  videoPausedForNetwork: false,
  micProcessing: 'clean',
  peerMicOn: true,
  peerVideoOn: true,
  diagnostics: null,
  peerDiagnostics: {},
  peerScreenSharing: false,
  /** Код сверки звонка (6 цифр), одинаковый у обоих участников. */
  verificationCode: '',
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
  ignoredCallOffers: 0,
  isGroup: false,
  groupChatId: null,
  participants: [],
  peerNames: {}
}

function makeCallId(): string {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sendMessage(message: SignalingMessage): boolean {
  return sendRuntimeMessage(message)
}

export const useCallStore = defineStore('call', {
  state: (): CallState => ({ ...DEFAULT_STATE }),

  getters: {
    isBusy: (state) => state.status === 'active' || state.status === 'outgoing',
    /** Можно ли переключать камеру/микрофон по ходу звонка. */
    canSwitchDevices: (state) => state.status === 'active',
    /** Качество связи для индикатора («Плохая связь»). */
    connectionQuality: (state): ConnectionQuality => {
      // В группе ориентируемся на ХУДШУЮ связь: если один собеседник нас не
      // слышит, показать «всё хорошо» — значит соврать. Кто именно страдает,
      // видно в панели диагностики (строка на каждого участника).
      const perPeer = Object.values(state.peerDiagnostics).map((item) => qualityOf(item))
      return perPeer.length > 0 ? worstQuality(perPeer) : qualityOf(state.diagnostics)
    },
    /** Куда идёт медиа: напрямую или через наш релей (бейдж в звонке). */
    callRoute: (state): CallRoute => callRoute(state.diagnostics?.candidateType),
    /** Подпись маршрута для бейджа. */
    callRouteLabel: (state): string => routeLabel(callRoute(state.diagnostics?.candidateType)),
    /** Пояснение к бейджу маршрута (в `title`). */
    callRouteHint: (state): string => routeHint(callRoute(state.diagnostics?.candidateType)),
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
        runtime.socket &&
        (runtime.socket.readyState === WebSocket.OPEN ||
          runtime.socket.readyState === WebSocket.CONNECTING)
      ) {
        if (runtime.socket.readyState === WebSocket.OPEN) return true
        return this._waitForSocketOpen()
      }
      runtime.socket = new WebSocket(socketUrl(token))
      runtime.socket.onopen = () => {
        this.connected = true
        if (this.status === 'active' || this.status === 'outgoing') {
          // Сигналинг вернулся: сообщаем об этом и перезапускаем ICE — медиа
          // шло по адресам прежней сети.
          this.reconnecting = false
          if (runtime.socketRetryTimer !== undefined) {
            window.clearTimeout(runtime.socketRetryTimer)
            runtime.socketRetryTimer = undefined
          }
          runtime.socketRetryDeadline = 0
          runtime.iceRestartAttempts = 0
          if (runtime.links.size > 0) this._scheduleIceRestart(ICE_RETRY_DELAY_MS)
          // Отвечающая сторона: повторяем ответ — пока канал был закрыт, он мог
          // «уйти в никуда», и зовущий всё ещё звонит.
          if (this.status === 'active' && !runtime.isCaller) this._resendAnswer()
        } else if (this.status === 'idle') {
          // Страница могла быть перезагружена во время звонка (случайный жест
          // «потянуть вниз», manual reload) — поднимаем его.
          void this.recoverCallAfterReload()
        }
      }
      runtime.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as SignalingMessage
          this._handleMessage(data)
        } catch {
          /* некорректное сообщение — игнорируем */
        }
      }
      runtime.socket.onclose = () => {
        this.connected = false
        runtime.socket = null
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
      if (runtime.socketRetryDeadline === 0) {
        runtime.socketRetryDeadline = Date.now() + LINK_RECOVERY_WINDOW_MS
      }
      if (runtime.socketRetryTimer !== undefined) window.clearTimeout(runtime.socketRetryTimer)
      runtime.socketRetryTimer = window.setTimeout(() => {
        runtime.socketRetryTimer = undefined
        if (this.status !== 'active' && this.status !== 'outgoing') return
        if (
          useAuthStore().isAuthenticated &&
          (runtime.socket === null || runtime.socket.readyState > 1)
        ) {
          void this.connect()
        }
        if (Date.now() >= runtime.socketRetryDeadline) {
          this.reconnecting = false
          runtime.socketRetryDeadline = 0
          const alive = [...runtime.links.values()].some(
            (link) => link.pc.iceConnectionState === 'connected'
          )
          if (alive) {
            return
          }
          this._forceEnd('Связь потеряна — звонок завершён')
          return
        }
        this._scheduleSocketRetry()
      }, LINK_RETRY_MS)
    },

    // ---------- Связи с участниками (личный и групповой звонок) ----------
    //
    // В личном разговоре связь одна, в групповом («mesh») — по одной на каждого
    // собеседника: медиа идёт напрямую, поэтому сервер пересылает SDP/ICE
    // конкретному человеку, а клиент раскладывает их по связям.

    /** Связь с участником (или null, если её ещё нет). */
    _linkFor(peerId: number | null): PeerLink | null {
      if (peerId === null) return null
      return runtime.links.get(peerId) ?? null
    },

    /** Связь «основного» собеседника: в 1:1 — единственная. */
    _primaryLink(): PeerLink | null {
      return this._linkFor(runtime.primaryPeerId) ?? this._linkFor(this.peerId)
    },

    /**
     * Создаёт соединение с участником и запоминает его.
     * `primary` — сделать эту связь «основной» (её видит одиночный интерфейс:
     * диагностика, бейдж маршрута; в группе основным остаётся первый).
     */
    _newLink(peerId: number, ice: RTCConfiguration, primary = true): PeerLink {
      const pc = new RTCPeerConnection(ice)
      const link: PeerLink = {
        peerId,
        pc,
        remoteStream: null,
        lastAnswerSdp: null,
        iceRestartInFlight: false,
        iceRestartAttempts: 0,
        offerAttempts: 0,
        offerSentAt: 0
      }
      runtime.links.set(peerId, link)
      if (primary || runtime.primaryPeerId === null) {
        runtime.primaryPeerId = peerId
        runtime.peerConnection = pc
      }
      this._wirePeerConnection(peerId, pc)
      return link
    },

    /**
     * Добавляет кандидата участника, а если применять ещё некуда — откладывает.
     *
     * Кандидаты зовущего приходят, пока у нас только звонит телефон: соединение
     * создаётся при ответе. Раньше такие кандидаты молча выбрасывались, ICE
     * оставался в состоянии `new`, и разговор не поднимался вовсе — собеседников
     * не было слышно и видно (только собственное видео).
     */
    _addCandidate(peerId: number, candidate: RTCIceCandidateInit): void {
      const link = this._linkFor(peerId)
      // Требовать удалённое описание беспокоит и обратный случай: у зовущего
      // кандидаты абонента приходят раньше, чем применён его ответ.
      if (!link || !link.pc.remoteDescription) {
        const list = runtime.pendingCandidates.get(peerId) ?? []
        list.push(candidate)
        runtime.pendingCandidates.set(peerId, list)
        return
      }
      void link.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined)
    },

    /** Отдаёт соединению отложенные кандидаты — после применения SDP собеседника. */
    _flushCandidates(peerId: number): void {
      const link = this._linkFor(peerId)
      if (!link || !link.pc.remoteDescription) return
      // Как только появилось удалённое описание, у приёмников есть дорожки —
      // ставим им цель буфера воспроизведения (меньше буфер — меньше задержка).
      tuneReceivers(link.pc, jitterTargetsFor(runtime.linkQuality.get(peerId) ?? null))
      const list = runtime.pendingCandidates.get(peerId)
      if (!list || list.length === 0) return
      runtime.pendingCandidates.delete(peerId)
      for (const candidate of list) {
        void link.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined)
      }
    },

    /** Убирает связь участника (он вышел или звонок закончился). */
    _dropLink(peerId: number): void {
      const link = runtime.links.get(peerId)
      if (!link) return
      // Голос участника (если он уже был подключён к выводу) больше не звучит:
      // иначе в микшере оставалась бы «мёртвая» дорожка.
      unwireRemoteOutput(link.remoteStream)
      // Передатчики ушедшего участника больше не понадобятся: держать их в
      // списке «приостановленных» нельзя — вернуть им видео было бы некуда.
      runtime.pausedVideoSenders = runtime.pausedVideoSenders.filter((sender) =>
        link.pc.getSenders().includes(sender)
      )
      try {
        link.pc.close()
      } catch {
        /* соединение могло уже закрыться */
      }
      runtime.links.delete(peerId)
      runtime.pendingCandidates.delete(peerId)
      runtime.statsSamples.delete(peerId)
      runtime.linkQuality.delete(peerId)
      runtime.linkSteps.delete(peerId)
      if (this.peerDiagnostics[peerId]) {
        const rest = { ...this.peerDiagnostics }
        delete rest[peerId]
        this.peerDiagnostics = rest
      }
      if (runtime.primaryPeerId === peerId) {
        const next = [...runtime.links.values()][0]
        runtime.primaryPeerId = next?.peerId ?? null
        runtime.peerConnection = next?.pc ?? null
      }
    },

    /** Выполняет действие над каждой связью (медиа, пересогласование, ICE). */
    _eachLink(action: (link: PeerLink) => void): void {
      for (const link of [...runtime.links.values()]) action(link)
    },

    /** Обновляет участника в списке интерфейса (в 1:1 список из одного). */
    _patchParticipant(peerId: number, patch: Partial<Omit<CallParticipant, 'id'>>): void {
      const index = this.participants.findIndex((item) => item.id === peerId)
      if (index === -1) return
      this.participants.splice(index, 1, { ...this.participants[index], ...patch })
    },

    /**
     * Запоминает имена участников чата: по ним подписываем плитки звонка.
     * Вызывается из чата, когда звонок идёт (состав сервер отдаёт без имён).
     */
    rememberPeerNames(entries: { id: number; name: string; avatarUrl?: string | null }[]): void {
      for (const entry of entries) {
        this.peerNames[entry.id] = { name: entry.name, avatarUrl: entry.avatarUrl ?? null }
      }
      // Уже показанные плитки тоже обновляем: иначе до пересборки состава
      // оставались бы «@29» и без аватара.
      for (const participant of this.participants) {
        const known = this.peerNames[participant.id]
        if (!known || participant.name === known.name) continue
        this._patchParticipant(participant.id, {
          name: known.name,
          avatarUrl: known.avatarUrl
        })
      }
    },

    /**
     * Приводит состав группового звонка к списку с сервера и достраивает связи.
     *
     * «Mesh» требует соединения «каждый с каждым», но двум сторонам нельзя
     * инициировать его одновременно (glare): соединение начинает тот, у кого
     * МЕНЬШИЙ id, а второй только отвечает. Правило простое и без конфликтов —
     * не нужно согласовывать, кто «главный» в комнате.
     */
    _applyGroupPeers(peers: number[], chatId: number | null): void {
      const myId = useAuthStore().current_user?.id ?? null
      if (myId === null) return
      const known = new Set(this.participants.map((item) => item.id))
      const fresh = peers.filter((id) => id !== myId && !known.has(id))
      for (const id of fresh) {
        const known = this.peerNames[id]
        this.participants.push({
          id,
          name: known?.name ?? `@${id}`,
          avatarUrl: known?.avatarUrl ?? null,
          micOn: true,
          videoOn: this.kind === 'video',
          screenSharing: false,
          connected: false,
          speaking: false
        })
      }
      // Ушедшие из звонка: закрываем им соединения и убираем плитку. Убираем
      // ТОЛЬКО тех, кто был подтверждён сервером и исчез из состава: иначе
      // приглашённый, до которого offer ещё не дошёл (`startGroupCall` зовёт их
      // по очереди, и это занимает секунды), пропадал бы из сетки — и заодно
      // исчезала кнопка «сбросить» у него.
      for (const item of [...this.participants]) {
        if (peers.includes(item.id)) continue
        if (!runtime.confirmedPeers.has(item.id)) continue
        this._dropLink(item.id)
        this.participants = this.participants.filter((row) => row.id !== item.id)
      }
      runtime.confirmedPeers = new Set(peers)
      if (chatId !== null) this.groupChatId = chatId
      // Состав изменился — у новых связей передатчики ещё без наших настроек.
      this._tuneMedia()
      // Пока звонок не принят (входящий) — соединения не поднимаем: медиа ещё
      // не разрешено, а собеседники решили бы, что мы уже в разговоре.
      if (this.status !== 'active' && this.status !== 'outgoing') return
      // Младший инициирует соединение со старшими — включая тех, кто уже был.
      // Если offer уже уходил и ответа нет (собеседник тогда ещё звонил) —
      // повторяем: состав приходит и после того, как кто-то поднял трубку.
      for (const id of peers) {
        if (id === myId || myId >= id) continue
        const link = runtime.links.get(id)
        if (link?.pc.remoteDescription) continue
        void this._offerToPeer(id, Boolean(link))
      }
    },

    /**
     * Достраивает «mesh» по текущему составу: соединяем меня с каждым, с кем
     * связи ещё нет, если инициировать должен я (младший по id).
     *
     * Зовётся после того, как разговор начался (первый ответил) и при ответе
     * присоединившегося позже — иначе второй-третий участники оставались бы без
     * соединения, хотя формально «уже в звонке».
     */
    _syncMesh(): void {
      const myId = useAuthStore().current_user?.id
      if (myId === undefined || myId === null) return
      const ids = [...this.participants.map((item) => item.id), myId]
      this._applyGroupPeers(ids, this.groupChatId)
    },

    /**
     * Создаёт связь с участником и отправляет ему offer (mesh).
     *
     * `retry` — повтор, когда связь уже создана, но ответа так и нет. Так бывает
     * у «среднего» участника группы: его offer ушёл, пока собеседник ещё звонил,
     * и был проигнорирован как «тот же звонок». Без повтора двое участников
     * навсегда оставались без связи друг с другом (слышал только зовущий).
     * Повторяем редко и не бесконечно — счётчики в самой связи.
     */
    async _offerToPeer(peerId: number, retry = false): Promise<void> {
      const existing = this._linkFor(peerId)
      // Связь уже согласована — переспрашивать нечего.
      if (existing?.pc.remoteDescription) return
      if (existing) {
        if (!retry) return
        if (existing.offerAttempts >= OFFER_MAX_ATTEMPTS) return
        if (Date.now() - existing.offerSentAt < OFFER_RETRY_MS) return
      }
      if (!this.callId) return
      try {
        const ice = await loadIceConfiguration()
        const link = existing ?? this._newLink(peerId, ice, false)
        link.offerAttempts += 1
        link.offerSentAt = Date.now()
        const stream = runtime.localMedia
        // Дорожки добавляем один раз: у повтора отправляем только новое описание.
        if (stream && link.pc.getSenders().length === 0) {
          stream.getTracks().forEach((track) => link.pc.addTrack(track, stream))
          applyTrackHints(stream)
          this._tuneMedia([link])
        }
        const sent = tunedDescription(await link.pc.createOffer())
        await link.pc.setLocalDescription(sent)
        sendMessage({
          type: 'call-offer',
          to_user_id: peerId,
          call_id: this.callId,
          kind: this.kind,
          sdp: sent.sdp ?? '',
          group: true,
          chat_id: this.groupChatId ?? undefined
        })
      } catch {
        this._dropLink(peerId)
      }
    },

    /**
     * Ответ на offer участника внутри уже идущего группового звонка:
     * новый собеседник не «звонит» повторно, а просто присоединяется.
     */
    async _acceptPeerOffer(peerId: number, sdp: string): Promise<void> {
      // У нас мог остаться свой неотвеченный offer (собеседник его проигнорировал,
      // пока звонил): применить к нему чужой offer нельзя — начинаем связь заново.
      const stale = this._linkFor(peerId)
      if (stale && !stale.pc.remoteDescription) this._dropLink(peerId)
      try {
        const ice = await loadIceConfiguration()
        const link = runtime.links.get(peerId) ?? this._newLink(peerId, ice, false)
        const stream = runtime.localMedia
        if (stream && link.pc.getSenders().length === 0) {
          stream.getTracks().forEach((track) => link.pc.addTrack(track, stream))
          applyTrackHints(stream)
          this._tuneMedia([link])
        }
        await link.pc.setRemoteDescription({ type: 'offer', sdp })
        const answer = tunedDescription(await link.pc.createAnswer())
        await link.pc.setLocalDescription(answer)
        link.lastAnswerSdp = answer.sdp ?? null
        this._flushCandidates(peerId)
        sendMessage({
          type: 'call-answer',
          to_user_id: peerId,
          call_id: this.callId ?? '',
          sdp: answer.sdp ?? '',
          group: true,
          chat_id: this.groupChatId ?? undefined
        })
      } catch {
        this._dropLink(peerId)
      }
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
          runtime.isCaller ? ICE_DISCONNECTED_GRACE_MS : ICE_DISCONNECTED_GRACE_MS * 1.7
        )
        return
      }
      if (state === 'failed') void this._restartIce(connection)
    },

    _resetIceRecovery() {
      if (runtime.iceRecoveryTimer !== undefined) {
        window.clearTimeout(runtime.iceRecoveryTimer)
        runtime.iceRecoveryTimer = undefined
      }
      if (runtime.rejoinTimer !== undefined) {
        window.clearTimeout(runtime.rejoinTimer)
        runtime.rejoinTimer = undefined
      }
      runtime.iceRestartAttempts = 0
      // Медиа пошло — значит ответ дошёл, повторять его больше не нужно.
      this._clearAnswerRetry()
      if (this.reconnecting && this.connected) this.reconnecting = false
    },

    _scheduleIceRestart(delay: number) {
      if (runtime.iceRecoveryTimer !== undefined) window.clearTimeout(runtime.iceRecoveryTimer)
      runtime.iceRecoveryTimer = window.setTimeout(() => {
        runtime.iceRecoveryTimer = undefined
        // Перезапускаем все соединения, у которых связь не поднялась: в группе
        // проблема с одним участником не должна ждать остальных.
        for (const link of [...runtime.links.values()]) {
          const state = link.pc.iceConnectionState
          if (state === 'connected' || state === 'completed') continue
          void this._restartIce(link.pc)
          return
        }
      }, delay)
    },

    /**
     * Наблюдает за медиа после установления звонка: соединение может числиться
     * установленным, а звука/видео не будет (чёрный экран, тишина).
     */
    _armMediaWatchdog() {
      this._clearMediaWatchdog()
      if (this.status !== 'active' || typeof window === 'undefined') return
      runtime.mediaWatchdogRestarts = 0
      runtime.mediaWatchdogTimer = window.setInterval(() => {
        void this._checkMediaFlow()
      }, MEDIA_WATCHDOG_INTERVAL_MS)
    },

    _clearMediaWatchdog() {
      if (runtime.mediaWatchdogTimer !== undefined) {
        window.clearInterval(runtime.mediaWatchdogTimer)
        runtime.mediaWatchdogTimer = undefined
      }
      runtime.mediaWatchdogFailures = 0
    },

    /**
     * Проверяет, идёт ли от собеседника медиа, и чинит соединение сам.
     *
     * Это автоматическая замена ручного «переключить Wi-Fi↔LTE»: если ICE/DTLS
     * считаются установленными, а пакеты не идут, перезапускаем ICE. Если медиа
     * уже идёт — наблюдатель выключается (своё дело сделал).
     */
    async _checkMediaFlow() {
      if (this.status !== 'active' || runtime.mediaWatchdogBusy) return
      const link = this._primaryLink()
      if (!link) {
        this._clearMediaWatchdog()
        return
      }
      const links = [...runtime.links.values()]
      runtime.mediaWatchdogBusy = true
      let flowing: boolean
      try {
        if (links.length > 1) {
          // Групповой звонок: собеседник мог не подключиться вовсе (вышел из
          // сети, отказался) — это НЕ значит, что у нас пропало медиа. Считаем
          // связь живой, если слышно хотя бы кого-то; перезапуск ICE — только
          // тем, от кого ничего не приходит, и без завершения звонка.
          const results = await Promise.all(
            links.map((item) => remoteMediaFlowing(item.pc).catch(() => false))
          )
          flowing = results.some(Boolean)
        } else {
          flowing = await remoteMediaFlowing(link.pc)
        }
      } finally {
        runtime.mediaWatchdogBusy = false
      }
      // Пока читали статистику, звонок мог закончиться или соединение — замениться.
      if (this.status !== 'active' || this._linkFor(link.peerId) !== link) return
      if (flowing) {
        // Медиа пошло. Если для этого не понадобилось ни одного перезапуска —
        // сеть в порядке, снимаем пометку «в прошлый раз помогал только релей».
        if (runtime.mediaWatchdogRestarts === 0) setRelayOnly(false)
        this._clearMediaWatchdog()
        return
      }
      runtime.mediaWatchdogFailures += 1
      // Зовущий ждёт меньше, отвечающий — дольше: иначе два одновременных
      // пересогласования SDP столкнутся (glare) и оба сорвутся.
      const failuresNeeded = runtime.isCaller
        ? MEDIA_WATCHDOG_FAILURES_BEFORE_RESTART
        : MEDIA_WATCHDOG_FAILURES_BEFORE_RESTART + 1
      if (runtime.mediaWatchdogFailures < failuresNeeded) return
      runtime.mediaWatchdogFailures = 0
      if (runtime.mediaWatchdogRestarts >= MEDIA_WATCHDOG_MAX_RESTARTS) {
        // Сами не починили — дальше только предупреждаем, звонок не рвём.
        this._clearMediaWatchdog()
        this.notice = 'Звук и видео не идут — попробуйте переключить сеть или перезвонить'
        return
      }
      runtime.mediaWatchdogRestarts += 1
      // Напрямую не выходит: в следующий раз начнём сразу через TURN-релей
      // (смена сети помогала именно потому, что заново поднимался ICE).
      if (runtime.mediaWatchdogRestarts >= 2) setRelayOnly(true)
      this.reconnecting = true
      if (links.length > 1) {
        // Перезапускаем ICE только у тех связей, от кого не идёт медиа: у
        // остальных разговор продолжается, и завершать звонок нельзя — в группе
        // «молчит один» это норма (он ещё не подключился или уже выпал).
        for (const item of links) {
          if (item.pc.iceConnectionState === 'connected' && item.remoteStream) continue
          await this._restartIce(item.pc)
        }
        return
      }
      await this._restartIce(link.pc)
    },

    /** Перезапуск ICE: собираем адреса на новых интерфейсах и пересогласуем SDP. */
    async _restartIce(connection: RTCPeerConnection) {
      const link = [...runtime.links.values()].find((item) => item.pc === connection)
      if (this.status !== 'active' || !link) return
      // Перезапуск уже идёт: второй только сожжёт попытки (см. наблюдатель медиа).
      if (runtime.iceRestartInFlight) return
      // Лимит попыток — СВОЙ у каждой связи. В группе один участник может так и
      // не подключиться (вышел из сети, отказался, экзотический NAT), и если
      // считать попытки общими, его неудачи израсходуют лимит у всех — разговор
      // со всеми рвётся из-за одного. Именно так и выглядела «потеря связи после
      // подключения не всех».
      if (link.iceRestartAttempts >= ICE_RESTART_MAX_ATTEMPTS) {
        this._patchParticipant(link.peerId, { connected: false })
        // Все связи мертвы — вот тогда звонок действительно закончился.
        if (!this._hasLiveLink()) {
          this._forceEnd('Связь потеряна — звонок завершён')
        }
        return
      }
      runtime.iceRestartInFlight = true
      link.iceRestartAttempts += 1
      this.reconnecting = true
      try {
        const pc = connection as RTCPeerConnection & { restartIce?: () => void }
        pc.restartIce?.()
        const offer = tunedDescription(await pc.createOffer({ iceRestart: true }))
        await pc.setLocalDescription(offer)
        if (this._linkFor(link.peerId) !== link || this.status !== 'active') return
        sendMessage({
          type: 'call-renegotiate',
          to_user_id: link.peerId,
          call_id: this.callId ?? '',
          sdp: offer.sdp ?? '',
          ...(this.isGroup ? { group: true, chat_id: this.groupChatId ?? undefined } : {})
        })
      } catch {
        /* не получилось — попробуем ещё раз по таймеру */
      } finally {
        runtime.iceRestartInFlight = false
      }
      this._scheduleIceRestart(ICE_RETRY_DELAY_MS)
    },

    /** Убирает участника из идущего группового звонка (отказ, выход, обрыв). */
    _dropParticipant(peerId: number): void {
      this._dropLink(peerId)
      this.participants = this.participants.filter((item) => item.id !== peerId)
      // Список «кто ещё говорит» — для плиток и подписи в шапке звонка.
      this.peerName = this.participants.map((item) => item.name).join(', ')
    },

    /** Есть ли хоть одна живая связь (в 1:1 — единственная). */
    _hasLiveLink(): boolean {
      return [...runtime.links.values()].some(
        (link) =>
          link.pc.iceConnectionState === 'connected' ||
          link.pc.iceConnectionState === 'completed' ||
          link.pc.connectionState === 'connected'
      )
    },

    /** Ожидает, пока сигнальный сокет откроется (до 9 секунд). */
    _waitForSocketOpen(): Promise<boolean> {
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          window.clearInterval(poll)
          resolve(runtime.socket !== null && runtime.socket.readyState === WebSocket.OPEN)
        }, 9000)
        const poll = window.setInterval(() => {
          if (runtime.socket && runtime.socket.readyState === WebSocket.OPEN) {
            window.clearInterval(poll)
            window.clearTimeout(timer)
            resolve(true)
          } else if (!runtime.socket || runtime.socket.readyState === WebSocket.CLOSED) {
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
      if (runtime.socket) {
        runtime.socket.onclose = null
        runtime.socket.close()
        runtime.socket = null
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
      if (!runtime.socket) return
      runtime.socket.onclose = null
      runtime.socket.close()
      runtime.socket = null
      this.connected = false
    },

    _handleMessage(message: SignalingMessage) {
      const from = message.from_user_id ?? 0
      const callId = message.call_id ?? ''
      switch (message.type) {
        case 'call-offer': {
          // Тот же групповой звонок, разговор уже идёт: новый участник не
          // «звонит» повторно, он присоединяется — отвечаем сразу, без окна
          // входящего. Сюда же попадает ПОВТОРНЫЙ offer участника mesh: первый
          // мог уйти, пока мы ещё не подняли трубку, и был проигнорирован.
          // Проверка стоит ДО «этот же звонок — игнорируем»: иначе она съедала
          // такие offer'ы, и двое участников группы так и не соединялись.
          if (
            this.isGroup &&
            message.group &&
            callId &&
            this.callId === callId &&
            (this.status === 'active' || this.status === 'outgoing') &&
            message.sdp
          ) {
            void this._acceptPeerOffer(from, message.sdp)
            break
          }
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
          runtime.pendingOffer = { callId, kind: message.kind ?? 'audio', sdp: message.sdp ?? '' }
          this.$patch({
            status: 'incoming',
            kind: message.kind ?? 'audio',
            callId,
            peerId: from,
            peerName: `@${from}`,
            peerAvatar: null,
            // Групповой вызов: запоминаем чат — состав придёт в `call-peers`.
            isGroup: Boolean(message.group),
            groupChatId: message.chat_id ?? null,
            participants: [
              {
                id: from,
                name: `@${from}`,
                avatarUrl: null,
                micOn: true,
                videoOn: message.kind === 'video',
                screenSharing: false,
                connected: false,
                speaking: false
              }
            ]
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
          const link = this._linkFor(message.from_user_id ?? this.peerId)
          // В группе ответ приходит и когда разговор уже идёт: кто-то поднял
          // трубку позже и присоединяется к нам. Раньше такой ответ молча
          // терялся (`status` уже `active`), и человек «входил» в пустоту.
          const relevant =
            this.callId === callId &&
            link &&
            (this.status === 'outgoing' || (this.isGroup && this.status === 'active'))
          if (relevant) {
            const answerLink = link as PeerLink
            if (message.sdp) {
              // Повторный ответ (страховка отвечающей стороны) не должен ронять
              // обработку: первый уже применён, второй просто игнорируем.
              void answerLink.pc
                .setRemoteDescription({ type: 'answer', sdp: message.sdp })
                .then(() => this._flushCandidates(answerLink.peerId))
                .catch(() => undefined)
            }
            if (this.status === 'outgoing') this._becomeActive()
            // Разговор уже идёт (или только начался) — достраиваем «mesh»:
            // новые собеседники соединяются с каждым, кто в звонке.
            if (this.isGroup) this._syncMesh()
          }
          break
        }
        case 'ice-candidate': {
          const candidate = message.candidate
          if (candidate && this.callId === callId) {
            // В группе адрес приходит от конкретного участника; в 1:1 — без
            // отправителя, значит от собеседника.
            this._addCandidate(message.from_user_id ?? this.peerId ?? 0, candidate)
          }
          break
        }
        case 'call-renegotiate': {
          // Собеседник меняет медиа (демонстрация экрана/смена устройства):
          // отвечаем своим SDP-ответом — ему, а не всем сразу.
          const link = this._linkFor(message.from_user_id ?? this.peerId)
          if (!link || this.callId !== callId || !message.sdp) return
          void this._answerRenegotiate(link.peerId, message.sdp)
          break
        }
        case 'call-renegotiate-answer': {
          const link = this._linkFor(message.from_user_id ?? this.peerId)
          if (!link || this.callId !== callId || !message.sdp) return
          void link.pc
            .setRemoteDescription({ type: 'answer', sdp: message.sdp })
            .then(() => this._flushCandidates(link.peerId))
            .catch(() => undefined)
          break
        }
        case 'call-rejoin': {
          // Собеседник перезагрузил страницу: у него новое соединение и новые
          // ICE-адреса, а его прежний SDP мёртв. Связь жива только у нас,
          // поэтому пересогласуемся заново: для него это выглядит как короткое
          // «Переподключаемся…», а не как сброшенный звонок.
          if (this.status !== 'active' || this.callId !== callId || runtime.links.size === 0) return
          runtime.iceRestartAttempts = 0
          for (const link of [...runtime.links.values()]) {
            void this._restartIce(link.pc)
          }
          break
        }
        case 'call-peers': {
          // Состав группового звонка: с этими людьми нужно соединиться (mesh).
          // Сервер присылает его при каждом входе участника.
          if (this.callId !== callId) break
          const peers = Array.isArray(message.peers) ? message.peers : []
          if (this.status === 'incoming') {
            // Пока разговор уже идёт, входящий вызов у того, кто ещё не ответил,
            // должен продолжать звонить: иначе через полторы минуты он «пропустит»
            // звонок, в котором все остальные давно разговаривают.
            this._armIncomingTimer()
          }
          this._applyGroupPeers(peers, message.chat_id ?? this.groupChatId)
          break
        }
        case 'call-media-state': {
          if (this.callId !== callId) break
          const micOn = message.mic_on !== false
          const videoOn = message.video_on !== false
          if (from !== 0) this._patchParticipant(from, { micOn, videoOn })
          // В личном разговоре состояние собеседника показывается напрямую (и
          // сообщение могло прийти без отправителя — от старого клиента).
          if (!this.isGroup || from === this.peerId) {
            this.peerMicOn = micOn
            this.peerVideoOn = videoOn
          }
          break
        }
        case 'call-screen': {
          if (this.callId !== callId) break
          // В группе показ экрана — свойство участника, в 1:1 — общее состояние.
          this._patchParticipant(from, { screenSharing: Boolean(message.sharing) })
          if (!this.isGroup || from === this.peerId) {
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
          if (this.callId !== callId) break
          // В группе отказ одного — не конец разговора: он просто не участвует.
          // Раньше здесь вызывался общий `_cleanup()`, и звонок обрывался у ВСЕХ
          // — именно так выглядела «потеря связи, когда подключились не все».
          // Важно и для статуса «звоним»: пока никто не ответил, отказ одного
          // участника закрывал экран звонка у инициатора, хотя остальные ещё
          // звенели.
          if (this.isGroup) {
            this._dropParticipant(from)
            if (this.participants.length === 0) {
              this._cleanup()
              this.notice = 'Никто не ответил'
            }
            break
          }
          if (this.status === 'outgoing') {
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
          if (this.callId !== callId) break
          // Меня убрали из звонка: сообщение адресовано именно сброшенному, а не
          // всем (см. `call-drop` на сервере). Для меня звонок закончился —
          // иначе экран вызова висел бы до сторожевого таймаута, хотя остальные
          // давно разговаривают, а «Отменить» им уже не отправить.
          if (message.reason === 'dropped') {
            this._cleanup()
            this.notice = 'Вас убрали из звонка'
            break
          }
          // В группе «завершение» от одного участника значит, что вышел именно
          // он: остальные продолжают звонить или разговаривать.
          if (this.isGroup) {
            this._dropParticipant(from)
            if (this.participants.length === 0) {
              this._cleanup()
              this.notice = 'Звонок завершён'
            }
            break
          }
          this._cleanup()
          this.notice = 'Звонок завершён'
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
            // «Занято» у группы значит, что в звонке уже четыре человека —
            // говорим об этом прямо, а не «недоступен».
            const full = message.reason === 'full'
            this._cleanup()
            this.notice = full
              ? `В звонке уже ${MAX_GROUP_PARTICIPANTS} человека — больше не помещается`
              : 'Абонент сейчас недоступен'
          }
          break
        }
        default:
          break
      }
    },

    /**
     * Начать ГРУППОВОЙ звонок «mesh» (до четырёх человек вместе со мной).
     *
     * Звоню каждому участнику группы отдельно: сервер только пересылает SDP, а
     * медиа идёт напрямую. Поэтому сквозное шифрование сохраняется — SFU, через
     * который медиа шло бы на сервере, тут не нужен.
     */
    async startGroupCall(chatId: number, members: CallPeer[], kind: CallKind) {
      if (this.status !== 'idle') return
      // Место в звонке занимаю я сам — остальным остаётся три.
      const targets = members.slice(0, MAX_GROUP_PARTICIPANTS - 1)
      if (targets.length === 0) return
      ensureCallOutput()
      this.$patch({
        status: 'outgoing',
        kind,
        callId: makeCallId(),
        peerId: targets[0].id,
        peerName: targets.map((item) => item.name).join(', '),
        peerAvatar: targets[0].avatarUrl ?? null,
        isGroup: true,
        groupChatId: chatId,
        participants: targets.map((item) => ({
          id: item.id,
          name: item.name,
          avatarUrl: item.avatarUrl ?? null,
          micOn: true,
          videoOn: kind === 'video',
          screenSharing: false,
          connected: false,
          speaking: false
        })),
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
        const { stream, kind: effectiveKind } = await acquireLocalMedia(kind, {
          cameraId: this.selectedCamera,
          micId: this.selectedMic,
          group: true,
          micProcessing: this.micProcessing
        })
        runtime.localMedia = stream
        this._applyAcquiredKind(kind, effectiveKind)
        runtime.isCaller = true
        // Соединение с каждым участником (медиа добавляется внутри `_offerToPeer`).
        for (const target of targets) await this._offerToPeer(target.id)
        this._armRingOutTimer()
        void this.loadDevices()
      } catch (error) {
        this._cleanup()
        this.notice = mediaErrorMessage(error, kind)
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
        isGroup: false,
        groupChatId: null,
        participants: [
          {
            id: peer.id,
            name: peer.name,
            avatarUrl: peer.avatarUrl ?? null,
            micOn: true,
            videoOn: kind === 'video',
            screenSharing: false,
            connected: false,
            speaking: false
          }
        ],
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
        const { stream, kind: effectiveKind } = await acquireLocalMedia(kind, {
          cameraId: this.selectedCamera,
          micId: this.selectedMic,
          micProcessing: this.micProcessing
        })
        runtime.localMedia = stream
        this._applyAcquiredKind(kind, effectiveKind)
        applyTrackHints(stream)
        const link = this._newLink(peer.id, ice)
        stream.getTracks().forEach((track) => link.pc.addTrack(track, stream))

        runtime.isCaller = true
        const offer = tunedDescription(await link.pc.createOffer())
        await link.pc.setLocalDescription(offer)
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
      if (this.status !== 'incoming' || !runtime.pendingOffer) return
      stopRingtone()
      // Контекст вывода создаём в жесте пользователя (иначе аудио заглушится).
      ensureCallOutput()
      const kind = runtime.pendingOffer.kind
      const offerSdp = runtime.pendingOffer.sdp
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
        const { stream, kind: effectiveKind } = await acquireLocalMedia(kind, {
          cameraId: this.selectedCamera,
          micId: this.selectedMic,
          micProcessing: this.micProcessing
        })
        runtime.localMedia = stream
        this._applyAcquiredKind(kind, effectiveKind)
        applyTrackHints(stream)
        const link = this._newLink(peerId, ice)
        stream.getTracks().forEach((track) => link.pc.addTrack(track, stream))
        await link.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp })
        const answer = tunedDescription(await link.pc.createAnswer())
        await link.pc.setLocalDescription(answer)
        runtime.isCaller = false
        this.kind = kind
        runtime.lastAnswerSdp = answer.sdp ?? null
        link.lastAnswerSdp = answer.sdp ?? null
        this._flushCandidates(peerId)
        sendMessage({
          type: 'call-answer',
          to_user_id: peerId,
          call_id: callId,
          sdp: answer.sdp ?? '',
          ...(this.isGroup ? { group: true, chat_id: this.groupChatId ?? undefined } : {})
        })
        this._becomeActive()
        // Групповой звонок: разговор со первым ответившим уже идёт, а остальные
        // продолжают звонить. Достраиваем соединения со всеми, кто в наборе,
        // чтобы позже принявшие подключились без повторного звонка.
        if (this.isGroup) this._syncMesh()
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
        runtime.answerRetryTimer = undefined
        const pc = runtime.peerConnection
        if (!pc || runtime.isCaller || this.status !== 'active' || !runtime.lastAnswerSdp) return
        if (
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed' ||
          pc.connectionState === 'connected'
        ) {
          return
        }
        if (runtime.answerRetryAttempts >= ANSWER_RETRY_MAX_ATTEMPTS) return
        runtime.answerRetryAttempts += 1
        this._resendAnswer()
        runtime.answerRetryTimer = window.setTimeout(tick, ANSWER_RETRY_MS)
      }
      runtime.answerRetryTimer = window.setTimeout(tick, ANSWER_RETRY_MS)
    },

    /** Отправляет сохранённый ответ ещё раз (см. `_armAnswerRetry`). */
    _resendAnswer() {
      if (runtime.isCaller || !runtime.lastAnswerSdp || this.status !== 'active') return
      sendMessage({
        type: 'call-answer',
        to_user_id: this.peerId ?? 0,
        call_id: this.callId ?? '',
        sdp: runtime.lastAnswerSdp
      })
    },

    _clearAnswerRetry() {
      if (runtime.answerRetryTimer !== undefined) {
        window.clearTimeout(runtime.answerRetryTimer)
        runtime.answerRetryTimer = undefined
      }
      runtime.answerRetryAttempts = 0
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
      const targets = this._callTargets()
      const context = this._callContext()
      this._cleanup()
      // Без гарантированной отправки собеседник продолжал бы звонить в тишине,
      // а в группе — ещё и каждый из приглашённых.
      for (const peerId of targets) {
        void this._sendSignaling({
          type: 'call-cancel',
          to_user_id: peerId,
          call_id: context.callId,
          ...context.extra
        })
      }
    },

    /** Завершить активный звонок. */
    endCall() {
      if (this.status === 'idle') return
      const targets = this._callTargets()
      const context = this._callContext()
      this._cleanup()
      for (const peerId of targets) {
        void this._sendSignaling({
          type: 'call-end',
          to_user_id: peerId,
          call_id: context.callId,
          ...context.extra
        })
      }
    },

    /** Признак группового звонка для исходящего сообщения. */
    _callContext(): { callId: string; extra: Partial<SignalingMessage> } {
      return {
        callId: this.callId ?? '',
        extra: this.isGroup ? { group: true, chat_id: this.groupChatId ?? undefined } : {}
      }
    },

    /**
     * Сбросить участника, который так и не подключился.
     *
     * В групповом звонке ждать неответившего нельзя: разговор уже идёт. Сервер по
     * `call-drop` убирает его из состава (и гасит у него окно вызова), а мы —
     * плитку и связь. Если после этого в звонке никого не осталось, звонок
     * завершается.
     */
    dropPeer(peerId: number): void {
      if (!this.callId) return
      const callId = this.callId
      const context = this._callContext()
      sendMessage({
        type: 'call-drop',
        to_user_id: peerId,
        call_id: callId,
        drop_user_id: peerId,
        ...context.extra
      })
      this._dropParticipant(peerId)
      if (this.isGroup && this.participants.length === 0) {
        this.endCall()
        this.notice = 'Звонок завершён'
      }
    },

    /**
     * Кому адресовать отмену/завершение: в группе — всем участникам набора,
     * иначе они продолжат звонить (или «висеть» в вызове), хотя разговор уже
     * закончился.
     */
    _callTargets(): number[] {
      if (this.isGroup && this.participants.length > 0) {
        return this.participants.map((item) => item.id)
      }
      return [this.peerId ?? 0]
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
      // Настраиваем отправку: битрейт и разрешение видео, приоритет звука, FEC
      // (см. `stores/call/quality.ts`). Дальше ступени подстраиваются по статистике.
      this._tuneMedia()
      // Пока звонок идёт — помним о нём: перезагрузка страницы не должна его терять.
      this.rememberCall()
      // Проверяем, что медиа действительно пошло (иначе чёрный экран и тишина,
      // а «лечится» это перезапуском ICE).
      this._armMediaWatchdog()
      // Собеседнику сразу сообщаем своё состояние микрофона/камеры, а себе берём
      // статистику соединения (индикатор качества и панель диагностики).
      this._sendMediaState()
      this._startStatsPolling()
      // «Кто говорит» — отдельным частым опросом: статистика идёт раз в 5 с, а
      // кольцо на плитке должно загораться почти сразу.
      this._startSpeakingPolling()
      // И код сверки: он считается из отпечатков сертификатов обеих сторон — до
      // подключения брать нечего.
      void this.refreshVerificationCode()
    },

    /**
     * Считает код сверки звонка из SDP обеих сторон.
     *
     * Код должен совпасть у обоих участников, поэтому берём отпечатки из
     * локального И удалённого SDP и сортируем их. Проверять есть смысл только
     * во время разговора — до этого соединения нет.
     */
    async refreshVerificationCode(): Promise<void> {
      const pc = this._primaryLink()?.pc
      if (!pc || this.status !== 'active') return
      try {
        this.verificationCode =
          (await callVerificationCode(
            pc.localDescription?.sdp ?? null,
            pc.remoteDescription?.sdp ?? null
          )) ?? ''
      } catch {
        /* WebCrypto может быть недоступен — звонку это не мешает */
      }
    },

    /** Сообщает собеседникам состояние своего микрофона и камеры. */
    _sendMediaState() {
      if (this.status !== 'active' || !this.callId) return
      const targets = this.isGroup ? this.participants.map((item) => item.id) : [this.peerId ?? 0]
      for (const targetId of targets) {
        sendMessage({
          type: 'call-media-state',
          to_user_id: targetId,
          call_id: this.callId,
          mic_on: this.micOn,
          // Показ экрана тоже идёт как видео — для собеседника картинка есть.
          // А приостановленное из-за связи видео — нет: собеседник должен
          // видеть аватар, а не «замершую» картинку.
          video_on: this.screenSharing || (this.videoOn && !this.videoPausedForNetwork),
          ...(this.isGroup ? { group: true, chat_id: this.groupChatId ?? undefined } : {})
        })
      }
    },

    /**
     * Снимает статистику соединения: качество связи и данные для диагностики.
     * Зовётся и по таймеру, и вручную из панели «Диагностика звонка».
     */
    async refreshDiagnostics(): Promise<void> {
      // Панель диагностики и индикатор качества показывают «основную» связь
      // (в 1:1 — единственную): одной общей картины по нескольким собеседникам
      // всё равно не бывает.
      const pc = this._primaryLink()?.pc
      if (pc && typeof pc.getStats === 'function') {
        try {
          const report = await pc.getStats()
          const { diagnostics, sample } = collectDiagnostics(report, pc, runtime.statsSample)
          runtime.statsSample = sample
          this.diagnostics = diagnostics
        } catch {
          /* статистика может быть недоступна — звонку не мешаем */
        }
      }
      await this._tuneLinksByStats()
      this._adaptNetworkVideo()
    },

    /**
     * Подстраивает настройки КАЖДОЙ связи по её собственной статистике.
     *
     * Так нужно ради групповых звонков («mesh»): у одного собеседника сеть
     * хорошая, у другого — нет. Одна общая ступень резала бы видео всем по
     * худшему, а для телефона важна именно суммарная отправка.
     */
    async _tuneLinksByStats(): Promise<void> {
      if (this.status !== 'active') return
      for (const link of [...runtime.links.values()]) {
        if (typeof link.pc.getStats !== 'function') continue
        try {
          const report = await link.pc.getStats()
          const { diagnostics, sample } = collectDiagnostics(
            report,
            link.pc,
            runtime.statsSamples.get(link.peerId) ?? null
          )
          runtime.statsSamples.set(link.peerId, sample)
          runtime.linkQuality.set(link.peerId, diagnostics)
          const step = this._effectiveStep(link.peerId, diagnostics)
          // Пока читали статистику, участник мог выйти — тогда его плитки уже нет.
          if (this._linkFor(link.peerId) !== link) continue
          // Для интерфейса: своя статистика на каждого участника (в группе «плохо
          // слышно» относится к конкретному собеседнику, а не к звонку целиком).
          this.peerDiagnostics = { ...this.peerDiagnostics, [link.peerId]: diagnostics }
          await this._applyLinkTuning(link, step)
        } catch {
          /* статистику не получить — оставляем прежние настройки связи */
        }
      }
    },

    /**
     * Действующая ступень связи с гистерезисом.
     *
     * Ухудшение применяем сразу (звук важнее красоты), улучшение — только выждав
     * паузу: на границе порогов ступень иначе «дышит» каждый опрос, и картинка то
     * расширяется, то ужимается.
     */
    _effectiveStep(peerId: number, diagnostics: CallDiagnostics): QualityStep {
      const next = qualityStepFor(diagnostics)
      const previous = runtime.linkSteps.get(peerId)
      const step = previous
        ? resolveStep(previous.step, next, Date.now() - previous.at, QUALITY_STEP_COOLDOWN_MS)
        : next
      if (!previous || step !== previous.step) {
        runtime.linkSteps.set(peerId, { step, at: Date.now() })
      }
      return step
    },

    /**
     * Применяет настройки к одной связи.
     *
     * `step` — действующая ступень этой связи; без неё (связь только что создана
     * и статистики ещё нет) берём «начальные» настройки: битрейт средний, а
     * разрешение и частоту кадров НЕ ухудшаем.
     */
    async _applyLinkTuning(link: PeerLink, step: QualityStep | undefined): Promise<void> {
      const diagnostics = runtime.linkQuality.get(link.peerId) ?? null
      // Ступень для видео своя: когда картинку ограничивает процессор (слабое
      // устройство), видео облегчается, а звук остаётся на сетевой ступени —
      // его кодирование дешёвое, и сужать его из-за CPU незачем.
      const tuning = step
        ? senderTuningForStep(step, this.screenSharing, videoStepFor(diagnostics))
        : initialSenderTuning(this.screenSharing)
      await tuneSenders(link.pc, tuning)
      tuneReceivers(link.pc, jitterTargetsFor(diagnostics))
      // Видео могло быть приостановлено ещё до появления этой связи.
      if (this.videoPausedForNetwork) await this._pauseVideoOnLink(link)
    },

    /**
     * Обновляет признак «говорит» по уровню звука собеседников.
     *
     * Уровень берём у Web Audio (`remoteLevels` — свой анализатор на каждого),
     * а не из `audioLevel` статистики: Chrome считает его только когда звук
     * выводится ЭЛЕМЕНТОМ, а в групповом звонке плитки заглушены и звук играет
     * Web Audio — там `audioLevel` нулевой (проверено живьём 18.09.2026). Если
     * Web Audio не запущен, звук как раз идёт через элемент — тогда статистика
     * работает и служит фолбэком.
     */
    _updateSpeaking() {
      // Признак нужен только там, где видны плитки других участников.
      if (this.status !== 'active' || this.participants.length < 2) return
      const viaWebAudio = remoteOutputReady()
      const levels = viaWebAudio ? remoteLevels() : new Map<number, number>()
      for (const participant of [...this.participants]) {
        const level = viaWebAudio
          ? (levels.get(participant.id) ?? 0)
          : (this.peerDiagnostics[participant.id]?.audioLevel ?? 0)
        const speaking = speakingNow(level, participant.speaking)
        if (speaking !== participant.speaking) {
          this._patchParticipant(participant.id, { speaking })
        }
      }
    },

    _startSpeakingPolling() {
      this._stopSpeakingPolling()
      if (typeof window === 'undefined') return
      runtime.speakingTimer = window.setInterval(
        () => this._updateSpeaking(),
        SPEAKING_POLL_INTERVAL_MS
      )
    },

    _stopSpeakingPolling() {
      if (runtime.speakingTimer !== undefined) {
        window.clearInterval(runtime.speakingTimer)
        runtime.speakingTimer = undefined
      }
    },

    /**
     * Приостанавливает видео, если связь долго не тянет.
     *
     * Одних ступеней битрейта и разрешения хватает не всегда: при потерях 8 %+ и
     * дрожании видео добивает и без того узкий канал, и звук начинает рваться.
     * Тогда честнее временно остаться без картинки, но сохранить разговор.
     *
     * Решение принимаем по ВСЕМ связям (`shouldPauseForQuality`): плохая связь с
     * одним собеседником не повод гасить картинку остальным — им мы отправляем
     * своим потоком, и ступени у связей свои.
     */
    _adaptNetworkVideo(): void {
      // Показ экрана человек включает осознанно и ненадолго — его не трогаем.
      if (this.kind !== 'video' || this.screenSharing || this.status !== 'active') {
        runtime.badQualityStreak = 0
        runtime.goodQualityStreak = 0
        return
      }
      const bad = shouldPauseForQuality([...runtime.linkSteps.values()].map((item) => item.step))
      runtime.badQualityStreak = bad ? runtime.badQualityStreak + 1 : 0
      runtime.goodQualityStreak = bad ? 0 : runtime.goodQualityStreak + 1
      if (!this.videoPausedForNetwork && runtime.badQualityStreak >= VIDEO_PAUSE_BAD_POLLS) {
        void this.pauseVideoForNetwork()
      } else if (
        this.videoPausedForNetwork &&
        runtime.goodQualityStreak >= VIDEO_RESUME_GOOD_POLLS
      ) {
        void this.resumeVideoForNetwork()
      }
    },

    /** Временно перестать отправлять видео (связь не тянет): звук важнее. */
    async pauseVideoForNetwork(): Promise<void> {
      if (this.status !== 'active' || this.kind !== 'video' || this.screenSharing) return
      if (this.videoPausedForNetwork) return
      this.videoPausedForNetwork = true
      runtime.badQualityStreak = 0
      runtime.goodQualityStreak = 0
      for (const link of [...runtime.links.values()]) await this._pauseVideoOnLink(link)
      // Собеседник видит аватар, а не «замершую» картинку.
      this._sendMediaState()
      this.notice = 'Связь слабая — видео приостановлено, чтобы не пропадал звук'
    },

    /** Снимает с видео-передатчиков дорожку и запоминает их, чтобы вернуть. */
    async _pauseVideoOnLink(link: PeerLink): Promise<void> {
      for (const sender of link.pc.getSenders()) {
        if (sender.track?.kind !== 'video') continue
        if (runtime.pausedVideoSenders.includes(sender)) continue
        runtime.pausedVideoSenders.push(sender)
        try {
          await sender.replaceTrack(null)
        } catch {
          /* соединение уже закрывается — не мешаем */
        }
      }
    },

    /** Возвращает видео после улучшения связи (или когда человек включил камеру). */
    async resumeVideoForNetwork(): Promise<void> {
      this.videoPausedForNetwork = false
      runtime.badQualityStreak = 0
      runtime.goodQualityStreak = 0
      const track = runtime.localMedia?.getVideoTracks()[0] ?? null
      const senders = runtime.pausedVideoSenders
      runtime.pausedVideoSenders = []
      if (track) {
        track.enabled = this.videoOn
        await Promise.all(
          senders.map((sender) => sender.replaceTrack(track).catch(() => undefined))
        )
      }
      this._sendMediaState()
      // Ступени могли устареть, пока видео стояло.
      this._tuneMedia()
    },

    _startStatsPolling() {
      this._clearStatsPolling()
      runtime.statsSample = null
      void this.refreshDiagnostics()
      runtime.statsTimer = window.setInterval(() => {
        void this.refreshDiagnostics()
      }, STATS_POLL_INTERVAL_MS)
    },

    _clearStatsPolling() {
      if (runtime.statsTimer !== undefined) {
        window.clearInterval(runtime.statsTimer)
        runtime.statsTimer = undefined
      }
      runtime.statsSample = null
    },

    /** Запоминает звонок для восстановления после перезагрузки страницы. */
    rememberCall() {
      if (!this.callId || !this.peerId || this.status !== 'active') return
      rememberActiveCall({
        callId: this.callId,
        peerId: this.peerId,
        kind: this.kind,
        isGroup: this.isGroup,
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
        const { stream, kind: effectiveKind } = await acquireLocalMedia(stored.kind, {
          cameraId: this.selectedCamera,
          micId: this.selectedMic,
          group: Boolean(stored.isGroup),
          micProcessing: this.micProcessing
        })
        runtime.localMedia = stream
        this._applyAcquiredKind(stored.kind, effectiveKind)
        const link = this._newLink(stored.peerId, ice)
        stream.getTracks().forEach((track) => link.pc.addTrack(track, stream))
        runtime.isCaller = false
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
      if (runtime.rejoinTimer !== undefined) window.clearTimeout(runtime.rejoinTimer)
      runtime.rejoinTimer = window.setTimeout(() => {
        runtime.rejoinTimer = undefined
        if (this.status !== 'active' || !this.reconnecting) return
        const alive = [...runtime.links.values()].some(
          (link) =>
            link.pc.iceConnectionState === 'connected' || link.pc.connectionState === 'connected'
        )
        if (alive) return
        this._forceEnd('Собеседник недоступен — звонок завершён')
      }, CALL_REJOIN_TIMEOUT_MS)
    },

    /**
     * Настраивает отправку медиа: битрейт и разрешение видео, приоритеты,
     * помехоустойчивость звука (см. `stores/call/quality.ts`). Зовётся при
     * поднятии связи, смене показа экрана и когда состав связей изменился.
     *
     * Для каждой связи берём её последнюю статистику: настройки не должны
     * «прыгать» в средние в ожидании следующего опроса.
     */
    _tuneMedia(links = [...runtime.links.values()]) {
      for (const link of links) {
        void this._applyLinkTuning(link, runtime.linkSteps.get(link.peerId)?.step)
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
      runtime.localMedia?.getAudioTracks().forEach((track) => {
        track.enabled = this.micOn
      })
      // Собеседник должен видеть, что нас не слышно (а не думать, что сломалось).
      this._sendMediaState()
    },

    /** Переключить камеру. */
    toggleCamera() {
      if (this.kind !== 'video' || this.screenSharing) return
      this.videoOn = !this.videoOn
      runtime.localMedia?.getVideoTracks().forEach((track) => {
        track.enabled = this.videoOn
      })
      // Человек включил камеру сам — его решение важнее авто-паузы по связи.
      if (this.videoOn && this.videoPausedForNetwork) {
        void this.resumeVideoForNetwork()
        return
      }
      this._sendMediaState()
    },

    /** Подтягивает сохранённый выбор устройств (до первого getUserMedia). */
    _restoreSavedDevices() {
      const saved = readCallDevices()
      if (!this.selectedCamera) this.selectedCamera = saved.camera ?? ''
      if (!this.selectedMic) this.selectedMic = saved.mic ?? ''
      if (!this.selectedSpeaker) this.selectedSpeaker = saved.speaker ?? ''
      // Режим обработки микрофона — тоже настройка устройства: запоминаем между звонками.
      if (saved.micProcessing) this.micProcessing = saved.micProcessing
    },

    /**
     * Переводит звонок в голосовой режим, если камера не далась.
     *
     * Раньше в этом случае звонок отменялся целиком — хотя разговаривать было
     * можно. Теперь сообщаем причину и продолжаем без видео.
     */
    _applyAcquiredKind(requested: CallKind, actual: CallKind) {
      if (requested === actual) return
      this.kind = 'audio'
      this.videoOn = false
      this.notice = 'Камера недоступна — звонок продолжается без видео'
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
      if (runtime.links.size === 0 || this.screenSharing) return
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
        // Мелкий текст на экране должен оставаться читаемым: кодеру сообщаем,
        // что это статичная картинка, а не движение (см. `tuneSenders`).
        try {
          track.contentHint = 'text'
        } catch {
          /* старые браузеры не знают contentHint */
        }
        runtime.screenTrack = track
        // Кнопка «Остановить показ» в самом браузере (плашка Chrome/Safari).
        track.onended = () => this.stopScreenShare()

        // Каким был звонок до показа: видеозвонок вернёт камеру, аудиозвонок — уберёт
        // видеолинию и останется аудио (см. `kindAfterScreenShare`).
        runtime.shareReturnKind = kindAfterScreenShare(this.kind)
        runtime.screenSenders = []
        let needsRenegotiate = false
        for (const link of [...runtime.links.values()]) {
          const sender = link.pc.getSenders().find((item) => item.track?.kind === 'video')
          if (sender) {
            // Видеозвонок: подменяем дорожку без пересогласования.
            await sender.replaceTrack(track).catch(() => undefined)
            runtime.screenSenders.push(sender)
          } else {
            // Аудиозвонок: добавляем видео-линию — нужен новый SDP для каждого.
            runtime.screenSenders.push(link.pc.addTrack(track, stream))
            needsRenegotiate = true
          }
        }
        if (needsRenegotiate) await this._renegotiate()
        // Гасим камеру на время показа (вернём при остановке) и показываем экран в превью.
        runtime.localMedia?.getVideoTracks().forEach((camera) => {
          camera.stop()
          runtime.localMedia?.removeTrack(camera)
        })
        if (!runtime.localMedia) runtime.localMedia = new MediaStream()
        runtime.localMedia.addTrack(track)
        this.screenSharing = true
        this.videoOn = true
        // Показ экрана отменяет авто-паузу видео: дорожку экрана гасить нельзя, а
        // запомненные «приостановленные» передатчики теперь заняты ею.
        this.videoPausedForNetwork = false
        runtime.pausedVideoSenders = []
        // Интерфейс становится видео-режимом: видно превью экрана и картинку собеседника.
        this.kind = 'video'
        this._sendScreenStatus(true)
        this._sendMediaState()
        this._tuneMedia()
      } catch {
        // Отказ от выбора окна в диалоге браузера — не ошибка.
        runtime.screenTrack = null
        runtime.screenSenders = []
        this.notice = ''
      }
    },

    /** Останавливает показ экрана и возвращает звонок к прежнему виду. */
    stopScreenShare() {
      const track = runtime.screenTrack
      const senders = runtime.screenSenders.length
        ? runtime.screenSenders
        : [...runtime.links.values()]
            .map((link) => link.pc.getSenders().find((item) => item.track?.kind === 'video'))
            .filter((item): item is RTCRtpSender => Boolean(item))
      runtime.screenTrack = null
      runtime.screenSenders = []
      if (track) {
        track.onended = null
        track.stop()
      }
      if (!this.screenSharing) return
      this.screenSharing = false
      if (track && runtime.localMedia) {
        runtime.localMedia.removeTrack(track)
      }
      if (runtime.shareReturnKind === 'audio') {
        // Звонок был аудио — камеру НЕ включаем: убираем видео-линию и
        // возвращаемся в аудио (интерфейс и у собеседника тоже).
        this.kind = 'audio'
        this.videoOn = false
        void Promise.all(senders.map((item) => this._dropVideoLine(item)))
        this._sendScreenStatus(false)
        this._sendMediaState()
        return
      }
      void this._restoreCamera(senders)
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
    async _restoreCamera(senders: RTCRtpSender[]) {
      if (runtime.links.size === 0) return
      try {
        const stream = await acquireCameraStream(this.selectedCamera, { group: this.isGroup })
        const track = stream.getVideoTracks()[0]
        if (!track) throw new Error('нет видеодорожки')
        swapTrackInStream(runtime.localMedia, track, 'video')
        applyTrackHints(runtime.localMedia)
        track.enabled = this.videoOn
        if (senders.length) {
          await Promise.all(senders.map((item) => item.replaceTrack(track).catch(() => undefined)))
        } else {
          this._eachLink((link) => {
            link.pc.addTrack(track, runtime.localMedia ?? new MediaStream([track]))
          })
        }
      } catch {
        // Камера недоступна — просто перестаём отправлять видео, звонок продолжается.
        await Promise.all(senders.map((item) => item.replaceTrack(null).catch(() => undefined)))
        this.videoOn = false
      }
    },

    _sendScreenStatus(sharing: boolean) {
      const targets = this.isGroup ? this.participants.map((item) => item.id) : [this.peerId ?? 0]
      for (const targetId of targets) {
        sendMessage({
          type: 'call-screen',
          to_user_id: targetId,
          call_id: this.callId ?? '',
          sharing,
          // В каком режиме продолжается звонок: собеседник вернёт аудио-интерфейс,
          // если показ экрана закончился в аудиозвонке.
          kind: sharing ? 'video' : this.kind,
          ...(this.isGroup ? { group: true, chat_id: this.groupChatId ?? undefined } : {})
        })
      }
    },

    /** Ответ на пересогласование от конкретного участника. */
    async _answerRenegotiate(peerId: number, sdp: string) {
      const link = this._linkFor(peerId)
      if (!link) return
      try {
        await link.pc.setRemoteDescription({ type: 'offer', sdp })
        const answer = tunedDescription(await link.pc.createAnswer())
        await link.pc.setLocalDescription(answer)
        this._flushCandidates(peerId)
        sendMessage({
          type: 'call-renegotiate-answer',
          to_user_id: peerId,
          call_id: this.callId ?? '',
          sdp: answer.sdp ?? '',
          ...(this.isGroup ? { group: true, chat_id: this.groupChatId ?? undefined } : {})
        })
      } catch {
        /* пересогласование не удалось — звонок продолжается как есть */
      }
    },

    /**
     * Инициирует пересогласование SDP (после добавления видео-линии).
     *
     * В группе — каждому участнику отдельно: у каждого своё соединение, и
     * общий SDP им не подходит.
     */
    async _renegotiate() {
      if (runtime.links.size === 0) return
      const seq = ++runtime.renegotiateSeq
      for (const link of [...runtime.links.values()]) {
        try {
          const offer = tunedDescription(await link.pc.createOffer())
          await link.pc.setLocalDescription(offer)
          if (seq !== runtime.renegotiateSeq) return
          sendMessage({
            type: 'call-renegotiate',
            to_user_id: link.peerId,
            call_id: this.callId ?? '',
            sdp: offer.sdp ?? '',
            ...(this.isGroup ? { group: true, chat_id: this.groupChatId ?? undefined } : {})
          })
        } catch {
          /* Пересогласование не удалось — звонок продолжается как есть. */
        }
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
      // В группе захват меньше: поток уходит каждому участнику («mesh»).
      const base = this.isGroup ? GROUP_VIDEO_CONSTRAINTS : VIDEO_CONSTRAINTS
      const constraints: MediaTrackConstraints = { ...base }
      if (this.selectedCamera) constraints.deviceId = { exact: this.selectedCamera }
      return constraints
    },

    /** Сменить камеру по ходу звонка (готовим превью без перезапуска звонка). */
    async setCameraDevice(deviceId: string) {
      this.selectedCamera = deviceId
      writeCallDevices({ camera: deviceId })
      if (this.status !== 'active' || this.screenSharing || this.kind !== 'video') return
      const senders = [...runtime.links.values()]
        .map((link) => link.pc.getSenders().find((item) => item.track?.kind === 'video'))
        .filter((item): item is RTCRtpSender => Boolean(item))
      if (senders.length === 0) return
      try {
        const stream = await acquireCameraStream(deviceId, { group: this.isGroup })
        const track = stream.getVideoTracks()[0]
        if (!track) return
        runtime.localMedia?.getVideoTracks().forEach((old) => {
          old.stop()
          runtime.localMedia?.removeTrack(old)
        })
        if (!runtime.localMedia) runtime.localMedia = new MediaStream()
        runtime.localMedia.addTrack(track)
        track.enabled = this.videoOn
        // Всем участникам одна и та же новая дорожка (mesh: у каждого своё
        // соединение, но источник медиа один — моя камера).
        await Promise.all(senders.map((item) => item.replaceTrack(track).catch(() => undefined)))
      } catch {
        this.notice = 'Не удалось переключить камеру'
      }
    },

    /** Сменить микрофон по ходу звонка. */
    async setMicDevice(deviceId: string) {
      this.selectedMic = deviceId
      writeCallDevices({ mic: deviceId })
      if (this.status !== 'active') return
      const ok = await this._replaceMicrophone(audioConstraints(deviceId, this.micProcessing))
      if (!ok) this.notice = 'Не удалось переключить микрофон'
    },

    /**
     * Сменить режим обработки микрофона: «чистый голос» (шумодав) или естественный.
     *
     * Смена режима — это НОВЫЙ запрос микрофона: констрейнты обработки задаются
     * только при захвате, на лету их не поменять. Поэтому режим меняется тем же
     * путём, что и устройство микрофона.
     */
    async setMicProcessing(mode: MicProcessing) {
      if (this.micProcessing === mode) return
      const previous = this.micProcessing
      this.micProcessing = mode
      writeCallDevices({ micProcessing: mode })
      if (this.status !== 'active') return
      const ok = await this._replaceMicrophone(audioConstraints(this.selectedMic, mode))
      if (!ok) {
        // Не вышло — возвращаем прежний режим, чтобы подпись в интерфейсе не врала.
        this.micProcessing = previous
        writeCallDevices({ micProcessing: previous })
        this.notice = 'Не удалось изменить обработку звука'
      }
    },

    /**
     * Меняет дорожку микрофона во всех связях.
     *
     * Старую дорожку гасим ТОЛЬКО после того, как новая встала на место: иначе
     * неудачная смена устройства или режима оставляла звонок без звука вообще.
     */
    async _replaceMicrophone(constraints: MediaTrackConstraints): Promise<boolean> {
      const senders = [...runtime.links.values()]
        .map((link) => link.pc.getSenders().find((item) => item.track?.kind === 'audio'))
        .filter((item): item is RTCRtpSender => Boolean(item))
      if (senders.length === 0) return true
      let track: MediaStreamTrack | null = null
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
        track = stream.getAudioTracks()[0] ?? null
        if (!track) return false
        track.enabled = this.micOn
        await Promise.all(
          senders.map((sender) => sender.replaceTrack(track).catch(() => undefined))
        )
      } catch {
        track?.stop()
        return false
      }
      for (const old of runtime.localMedia?.getAudioTracks() ?? []) {
        if (old === track) continue
        old.stop()
        runtime.localMedia?.removeTrack(old)
      }
      if (!runtime.localMedia) runtime.localMedia = new MediaStream()
      runtime.localMedia.addTrack(track)
      applyTrackHints(runtime.localMedia)
      return true
    },

    /** Выбрать динамик (применит интерфейс через setSinkId, если браузер умеет). */
    setSpeakerDevice(deviceId: string) {
      this.selectedSpeaker = deviceId
      writeCallDevices({ speaker: deviceId })
    },

    /** Возвращает текущий локальный поток (для превью). */
    getLocalStream(): MediaStream | null {
      return runtime.localMedia
    },

    /** Возвращает текущий удалённый поток (для видео собеседника). */
    getRemoteStream(): MediaStream | null {
      return runtime.remoteMedia
    },

    /**
     * Поток конкретного участника группового звонка.
     *
     * Не геттер: поток лежит вне реактивного состояния (MediaStream в Pinia
     * хранить нельзя), и плитка перерисовывается по изменениям `participants` —
     * крик `_patchParticipant` на `ontrack` как раз это и делает.
     */
    remoteStreamOf(peerId: number): MediaStream | null {
      return runtime.links.get(peerId)?.remoteStream ?? null
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
          this.notice = this.isGroup ? 'Никто не ответил' : 'Абонент не отвечает'
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
      runtime.incomingDeadline = Date.now() + INCOMING_STALE_TIMEOUT_MS
      runtime.incomingTimer = window.setTimeout(() => {
        runtime.incomingTimer = undefined
        this.dropStaleRinging()
      }, INCOMING_STALE_TIMEOUT_MS)
    },

    _clearIncomingTimer() {
      runtime.incomingDeadline = 0
      if (runtime.incomingTimer !== undefined) {
        window.clearTimeout(runtime.incomingTimer)
        runtime.incomingTimer = undefined
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
      if (!runtime.incomingDeadline || Date.now() < runtime.incomingDeadline) return false
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
      if (runtime.screenTrack) {
        runtime.screenTrack.onended = null
        runtime.screenTrack.stop()
        runtime.screenTrack = null
      }
      runtime.screenSenders = []
      runtime.shareReturnKind = 'video'
      runtime.renegotiateSeq += 1
      // Групповой звонок: закрываем ВСЕ соединения, а не только основное.
      for (const link of [...runtime.links.values()]) {
        link.pc.onicecandidate = null
        link.pc.ontrack = null
        try {
          link.pc.close()
        } catch {
          /* уже закрыто */
        }
      }
      runtime.links.clear()
      runtime.confirmedPeers.clear()
      runtime.pendingCandidates.clear()
      runtime.primaryPeerId = null
      runtime.peerConnection = null
      this.isGroup = false
      this.groupChatId = null
      this.participants = []
      stopAllTracks(runtime.localMedia)
      stopAllTracks(runtime.remoteMedia)
      teardownCallOutput()
      runtime.localMedia = null
      runtime.remoteMedia = null
      runtime.pendingOffer = null
      if (runtime.iceRecoveryTimer !== undefined) {
        window.clearTimeout(runtime.iceRecoveryTimer)
        runtime.iceRecoveryTimer = undefined
      }
      if (runtime.rejoinTimer !== undefined) {
        window.clearTimeout(runtime.rejoinTimer)
        runtime.rejoinTimer = undefined
      }
      if (runtime.socketRetryTimer !== undefined) {
        window.clearTimeout(runtime.socketRetryTimer)
        runtime.socketRetryTimer = undefined
      }
      runtime.iceRestartAttempts = 0
      runtime.socketRetryDeadline = 0
      runtime.isCaller = false
      runtime.lastAnswerSdp = null
      runtime.iceRestartInFlight = false
      runtime.mediaWatchdogRestarts = 0
      // Настройки связей и «пауза видео» относятся к прошедшему звонку.
      runtime.statsSamples.clear()
      runtime.linkQuality.clear()
      runtime.linkSteps.clear()
      runtime.pausedVideoSenders = []
      runtime.badQualityStreak = 0
      runtime.goodQualityStreak = 0
      this._clearAnswerRetry()
      this._clearMediaWatchdog()
      this._clearStatsPolling()
      this._stopSpeakingPolling()
      // Звонок завершён осознанно — поднимать его после перезагрузки не нужно.
      forgetActiveCall()
      // Код сверки относится к конкретному соединению: в новом звонке он другой.
      this.verificationCode = ''
      // Режим обработки микрофона — настройка человека, а не звонка: сохраняем.
      this.$patch({
        ...DEFAULT_STATE,
        connected: this.connected,
        micProcessing: this.micProcessing
      })
    },

    /**
     * Пересчитывает «есть видео/звук» по живым дорожкам потока участника.
     *
     * Зовётся по событиям самой дорожки (`mute`/`unmute`/`ended`): у удалённого
     * трека они приходят уже после первого кадра, и без перерисовки плитка
     * оставалась с аватаром, хотя видео собеседника шло.
     */
    _refreshPeerMedia(peerId: number): void {
      const stream = this._linkFor(peerId)?.remoteStream
      if (!stream) return
      this._patchParticipant(peerId, {
        videoOn: hasLiveTrack(stream, 'video'),
        micOn: stream.getAudioTracks().length > 0
      })
    },

    /**
     * Идёт ли от участника живое видео — по этому признаку плитка показывает
     * картинку, а не аватар.
     */
    remoteHasVideo(peerId: number): boolean {
      const stream = runtime.links.get(peerId)?.remoteStream
      return stream ? hasLiveTrack(stream, 'video') : false
    },

    _wirePeerConnection(peerId: number, connection: RTCPeerConnection) {
      // Смена сети: следим за состоянием ICE и при необходимости перезапускаем.
      connection.oniceconnectionstatechange = () => this._handleIceState(connection)
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'connected') {
          this._patchParticipant(peerId, { connected: true })
          if (this.status === 'outgoing') {
            // Собеседник принял звонок: подтверждение могло не дойти — доводим
            // состояние по факту соединения (в группе — по первому соединению).
            this._becomeActive()
          }
        }
        if (connection.connectionState === 'closed' || connection.connectionState === 'failed') {
          this._patchParticipant(peerId, { connected: false })
        }
      }
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage({
            type: 'ice-candidate',
            // Без самого адреса сообщение бессмысленно: собеседник не узнает,
            // куда слать медиа, ICE останется в состоянии `new` и разговор не
            // поднимется вовсе (видно только своё видео, звука нет).
            candidate: event.candidate.toJSON(),
            // Кандидаты уходят КОНКРЕТНОМУ участнику: в групповом звонке у нас
            // своё соединение с каждым, и in общий адрес их слать нельзя.
            to_user_id: peerId,
            call_id: this.callId ?? '',
            ...(this.isGroup ? { group: true, chat_id: this.groupChatId ?? undefined } : {})
          })
        }
      }
      connection.ontrack = (event) => {
        // Собираем удалённый поток надёжно: не затираем уже пришедшие треки
        // последним событием (иначе на части браузеров остаётся только аудио
        // или только видео — видео собеседника «не видно»).
        const incoming = event.streams && event.streams[0]
        const link = this._linkFor(peerId)
        let stream = link?.remoteStream ?? null
        if (!stream) {
          stream = new MediaStream()
          if (link) link.remoteStream = stream
          // Одиночный интерфейс (1:1) читает поток из runtime.remoteMedia.
          if (runtime.remoteMedia === null || runtime.links.size <= 1) {
            runtime.remoteMedia = stream
          }
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
        // Обновляем признаки «есть видео/звук» — плитка участника в сетке.
        this._patchParticipant(peerId, {
          videoOn: stream.getVideoTracks().length > 0,
          micOn: stream.getAudioTracks().length > 0
        })
        // У удалённой дорожки признак `muted` снимается только когда пойдут
        // данные. Без этих событий плитка так и оставалась с аватаром, хотя
        // видео уже шло — «у откликнувшихся видно только своё видео».
        event.track.onunmute = () => this._refreshPeerMedia(peerId)
        event.track.onmute = () => this._refreshPeerMedia(peerId)
        event.track.onended = () => this._refreshPeerMedia(peerId)
        // Звук собеседника — через Web Audio (не зависит от element.volume).
        wireRemoteOutput(stream, peerId)
      }
    }
  }
})
