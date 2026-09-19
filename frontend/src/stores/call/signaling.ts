import type { CallDiagnostics, StatsSample } from '@/utils/callStats'

import type { QualityStep } from './quality'
import type { VideoEffectsRuntime } from './videoPipeline'

import type { CallKind, SignalingMessage } from './types'

export interface PendingOffer {
  callId: string
  kind: CallKind
  sdp: string
}

/**
 * Одно соединение звонка: с каждым участником — своё.
 *
 * В личном разговоре связь одна, в групповом их столько, сколько собеседников
 * («mesh»: 4 участника — 3 связи). Раньше в сторе жил ровно один
 * `peerConnection`, и второй собеседник был невозможен.
 */
export interface PeerLink {
  peerId: number
  pc: RTCPeerConnection
  /** Поток собеседника: его камера/микрофон (в сетке — отдельная плитка). */
  remoteStream: MediaStream | null
  /** Последний отправленный ему ответ: повторяем, если сигналинг отвалился. */
  lastAnswerSdp: string | null
  /** Перезапуск ICE уже идёт — не дублируем при шторме состояний. */
  iceRestartInFlight: boolean
  /**
   * Сколько раз перезапускали ICE именно для этого участника.
   *
   * Счётчик обязан быть своим на связь: в группе один собеседник может так и не
   * подключиться (вышел из сети, отказался), и его попытки не должны израсходовать
   * лимит у остальных — иначе разговор со всеми рвётся из-за одного.
   */
  iceRestartAttempts: number
  /** Сколько раз мы отправляли offer (первый + повторы, см. `_offerToPeer`). */
  offerAttempts: number
  /** Когда отправлен последний offer — чтобы повторять не чаще `OFFER_RETRY_MS`. */
  offerSentAt: number
}

export interface CallSignalingRuntime {
  socket: WebSocket | null
  /**
   * Соединение «основного» собеседника (в 1:1 — единственное).
   *
   * Это доступ к `links` для одиночного разговора: код, которому нужен именно
   * собеседник (диагностика, бейдж маршрута), обращается сюда, а всё сетевое
   * (`addTrack`, пересогласование, показ экрана) идёт по всем связям сразу.
   */
  peerConnection: RTCPeerConnection | null
  /** Связи со всеми участниками звонка: ключ — id пользователя. */
  links: Map<number, PeerLink>
  /** Чей `pc` сейчас в `peerConnection` (для 1:1 и одиночных подписок). */
  primaryPeerId: number | null
  /**
   * Кто из участников уже подтверждён сервером (`call-peers`).
   *
   * Нужно, чтобы не путать «ещё не подключился» с «вышел»: из списка убираем
   * только тех, кто был подтверждён и исчез, а приглашённых, до которых offer
   * ещё не дошёл, оставляем плиткой «Звоним…».
   */
  confirmedPeers: Set<number>
  /**
   * Кандидаты ICE, пришедшие раньше, чем появилось соединение с их отправителем.
   *
   * Зовущий собирает адреса сразу после своего offer — то есть пока у абонента
   * только звонит телефон и соединения ещё нет. Без этой памяти такие кандидаты
   * терялись, ICE оставался в состоянии `new`, и разговор не поднимался вовсе
   * (медиа не идёт, видно только своё видео).
   */
  pendingCandidates: Map<number, RTCIceCandidateInit[]>
  /**
   * Замеры статистики по КАЖДОЙ связи: скорость считаем по своему интервалу.
   *
   * В group-звонке («mesh») качество у собеседников разное, поэтому один общий
   * замер не годится — по нему резали бы видео всем по худшему.
   */
  statsSamples: Map<number, StatsSample>
  /** Последняя снятая диагностика по каждой связи (для настроек без опроса). */
  linkQuality: Map<number, CallDiagnostics>
  /**
   * Действующая ступень качества по каждой связи и когда она сменилась.
   *
   * Нужна для гистерезиса: ухудшение применяем сразу, а улучшение — только
   * выждав паузу, иначе ступень «дышит» на границе порогов.
   */
  linkSteps: Map<number, { step: QualityStep; at: number }>
  /**
   * Отправители видео, у которых мы сняли дорожку из-за плохой связи.
   *
   * Держим их явно: после `replaceTrack(null)` найти такой передатчик по дорожке
   * уже нельзя, и вернуть видео было бы нечем.
   */
  pausedVideoSenders: RTCRtpSender[]
  /** Сколько опросов подряд связь «плохая» — по нему приостанавливаем видео. */
  badQualityStreak: number
  /** Сколько опросов подряд связь «хорошая» — по нему возвращаем видео. */
  goodQualityStreak: number
  /** Таймер обновления признака «говорит» (уровень звука собеседников). */
  speakingTimer: number | undefined
  localMedia: MediaStream | null
  /**
   * Дорожка камеры КАК ЕЁ ОТДАЛ БРАУЗЕР (без эффектов).
   *
   * Нужна, чтобы можно было включить/выключить эффекты на ходу: в `localMedia` и
   * у передатчиков лежит уже обработанная дорожка, и без «сырой» вернуть
   * обычный кадр было бы нечем.
   */
  rawCameraTrack: MediaStreamTrack | null
  /** Обработка видео (эффекты и маски) — см. `stores/call/videoPipeline.ts`. */
  videoEffects: VideoEffectsRuntime | null
  remoteMedia: MediaStream | null
  pendingOffer: PendingOffer | null
  screenTrack: MediaStreamTrack | null
  /** Отправители видео, которым подменена дорожка экрана (по одному на связь). */
  screenSenders: RTCRtpSender[]
  shareReturnKind: CallKind
  renegotiateSeq: number
  incomingTimer: number | undefined
  incomingDeadline: number
  rejoinTimer: number | undefined
  iceRecoveryTimer: number | undefined
  iceRestartAttempts: number
  socketRetryTimer: number | undefined
  socketRetryDeadline: number
  isCaller: boolean
  lastAnswerSdp: string | null
  answerRetryTimer: number | undefined
  answerRetryAttempts: number
  mediaWatchdogTimer: ReturnType<typeof setInterval> | undefined
  mediaWatchdogFailures: number
  mediaWatchdogRestarts: number
  mediaWatchdogBusy: boolean
  iceRestartInFlight: boolean
  statsTimer: number | undefined
  statsSample: StatsSample | null
}

/** Связь с участником по его id (создаётся лениво). */
export function linkOf(peerId: number): PeerLink | undefined {
  return runtime.links.get(peerId)
}

/** Все связи звонка: в 1:1 одна, в групповом — по одной на собеседника. */
export function links(): PeerLink[] {
  return [...runtime.links.values()]
}

export const runtime: CallSignalingRuntime = {
  socket: null,
  peerConnection: null,
  links: new Map<number, PeerLink>(),
  primaryPeerId: null,
  confirmedPeers: new Set<number>(),
  pendingCandidates: new Map<number, RTCIceCandidateInit[]>(),
  localMedia: null,
  rawCameraTrack: null,
  videoEffects: null,
  remoteMedia: null,
  pendingOffer: null,
  screenTrack: null,
  screenSenders: [],
  shareReturnKind: 'video',
  renegotiateSeq: 0,
  incomingTimer: undefined,
  incomingDeadline: 0,
  rejoinTimer: undefined,
  iceRecoveryTimer: undefined,
  iceRestartAttempts: 0,
  socketRetryTimer: undefined,
  socketRetryDeadline: 0,
  isCaller: false,
  lastAnswerSdp: null,
  answerRetryTimer: undefined,
  answerRetryAttempts: 0,
  mediaWatchdogTimer: undefined,
  mediaWatchdogFailures: 0,
  mediaWatchdogRestarts: 0,
  mediaWatchdogBusy: false,
  iceRestartInFlight: false,
  statsTimer: undefined,
  statsSample: null,
  statsSamples: new Map<number, StatsSample>(),
  linkQuality: new Map<number, CallDiagnostics>(),
  linkSteps: new Map<number, { step: QualityStep; at: number }>(),
  pausedVideoSenders: [],
  badQualityStreak: 0,
  goodQualityStreak: 0,
  speakingTimer: undefined
}

export function sendRuntimeMessage(message: SignalingMessage): boolean {
  if (runtime.socket && runtime.socket.readyState === WebSocket.OPEN) {
    runtime.socket.send(JSON.stringify(message))
    return true
  }
  return false
}
