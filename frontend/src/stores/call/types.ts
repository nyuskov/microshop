/** Тип вызова: только голос или голос + видео. */
export type CallKind = 'audio' | 'video'
/** Почему показ экрана недоступен (или 'ok', если всё в порядке). */
export type ScreenShareSupport = 'ok' | 'insecure' | 'mobile' | 'unsupported'

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

export interface SignalingMessage {
  type: string
  call_id?: string
  from_user_id?: number
  to_user_id?: number
  kind?: CallKind
  sdp?: string
  candidate?: RTCIceCandidateInit
  reason?: string
  /** Групповой звонок: сообщение относится к общему звонку в чате. */
  group?: boolean
  /** Чат группового звонка (сервер проверяет по нему участие). */
  chat_id?: number
  /** Для `call-peers`: кто сейчас в групповом звонке. */
  peers?: number[]
  /** Для `call-drop`: кого участник сбрасывает (тот не поднял трубку). */
  drop_user_id?: number
  /** Для ``call-screen`` — начинает/заканчивает ли собеседник показ экрана. */
  sharing?: boolean
  /** Для ``call-parked`` — отправлено ли собеседнику уведомление о звонке. */
  notified?: boolean
  /** Для ``call-media-state`` — микрофон и камера собеседника. */
  mic_on?: boolean
  video_on?: boolean
}

/**
 * Участник звонка в интерфейсе (в 1:1 он один).
 *
 * Групповой звонок — полносвязная «mesh»-схема: видео и звук идут напрямую
 * каждому собеседнику, поэтому состояние микрофона и камеры приходит от каждого
 * участника отдельно (`call-media-state`).
 */
export interface CallParticipant {
  id: number
  name: string
  avatarUrl?: string | null
  /** Микрофон участника (по его сигналу). */
  micOn: boolean
  /** Идёт ли видео от участника (камера или показ экрана). */
  videoOn: boolean
  /** Показывает экран. */
  screenSharing: boolean
  /** Соединение с участником установлено (по ICE). */
  connected: boolean
}
