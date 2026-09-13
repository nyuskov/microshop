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
  /** Для ``call-screen`` — начинает/заканчивает ли собеседник показ экрана. */
  sharing?: boolean
  /** Для ``call-parked`` — отправлено ли собеседнику уведомление о звонке. */
  notified?: boolean
  /** Для ``call-media-state`` — микрофон и камера собеседника. */
  mic_on?: boolean
  video_on?: boolean
}
