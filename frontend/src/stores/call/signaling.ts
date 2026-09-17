import type { StatsSample } from '@/utils/callStats'

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
   * Битрейт отправляемого видео под текущее качество сети (бит/с).
   *
   * Меняется ступенями по статистике (`_adaptVideoBitrate`), а не на каждом
   * опросе: дёргать `setParameters` зря не нужно.
   */
  videoBitrate: number
  localMedia: MediaStream | null
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
  videoBitrate: 0,
  localMedia: null,
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
  statsSample: null
}

export function sendRuntimeMessage(message: SignalingMessage): boolean {
  if (runtime.socket && runtime.socket.readyState === WebSocket.OPEN) {
    runtime.socket.send(JSON.stringify(message))
    return true
  }
  return false
}
