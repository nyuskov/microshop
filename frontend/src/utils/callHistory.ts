/**
 * Экран «Звонки»: правила показа записи о звонке.
 *
 * Записи о звонках сервер отдаёт как «почти сообщение» (`kind='call'`: тип,
 * исход, длительность, инициатор). Здесь из этих полей собираются подписи,
 * иконки, фильтры и группировка по дням — чистые функции, чтобы правила
 * проверялись тестами, а не в разметке.
 */
import { t } from '@/i18n'
import type { ChatUser } from '@/types'
import { dayLabel, formatChatTime, formatMsgTime } from '@/utils/format'

/** Одна запись о звонке (ответ `GET /calls/history/`). */
export interface CallHistoryItem {
  id: number
  chat_id: number
  /** Собеседник; null — аккаунт удалён, покажем заглушку. */
  peer: ChatUser | null
  call_kind: string
  /** completed | missed | declined */
  call_state: string
  call_duration: number
  timestamp: string
  /** Звонил ли сам человек. */
  outgoing: boolean
}

/** Страница истории звонков. */
export interface CallHistoryPage {
  items: CallHistoryItem[]
  total: number
}

/** Фильтры списка: всё и только пропущенные. */
export type CallFilterKey = 'all' | 'missed'

export const CALL_FILTERS: { key: CallFilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'missed', label: 'Пропущенные' }
]

/**
 * Пропущенным считаем только входящий звонок без разговора.
 *
 * «Отклонённый» (declined) — это тоже не разговор, но по нему человек уже
 * принял решение (сам нажал «Отклонить» или отклонил из уведомления): в фильтре
 * «Пропущенные» ему делать нечего, иначе фильтр не помогал бы найти то, на что
 * не ответили случайно.
 */
export const isMissedCall = (item: CallHistoryItem): boolean =>
  item.call_state === 'missed' && !item.outgoing

/** Проходит ли запись выбранный фильтр. */
export const matchesCallFilter = (item: CallHistoryItem, filter: CallFilterKey): boolean =>
  filter === 'missed' ? isMissedCall(item) : true

/** Иконка записи: пропущенный — «пропущенный звонок», отказ — «сброшен», иначе тип. */
export const callHistoryIcon = (item: CallHistoryItem): string => {
  if (isMissedCall(item)) return 'call_missed'
  if (item.call_state === 'declined') return 'call_end'
  return item.call_kind === 'video' ? 'videocam' : 'call'
}

/** Длительность разговора «2:05» (пусто — не разговаривали). */
export const formatCallDuration = (seconds: number): string => {
  const total = Math.max(0, Math.trunc(seconds))
  if (!total) return ''
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** Тип звонка словом. */
export const callKindLabel = (item: CallHistoryItem): string =>
  item.call_kind === 'video' ? t('Видео') : t('Аудио')

/**
 * Подпись строки: исход, направление и длительность.
 *
 * Порядок такой: сначала то, что человек ищет глазами (пропустил или нет), потом
 * направление, потом цифры. «Отклонён» пишем только для исходящих: у входящего
 * отказ выглядит как пропущенный — иначе «Вы не ответили» читалось бы как
 * «вам отказали».
 */
export const callHistoryLabel = (item: CallHistoryItem): string => {
  if (isMissedCall(item)) return t('Пропущенный')
  const kind = callKindLabel(item)
  if (item.call_state === 'declined') {
    return item.outgoing ? t('{kind} · отклонён', { kind }) : t('{kind} · не ответили', { kind })
  }
  const duration = formatCallDuration(item.call_duration)
  const direction = item.outgoing ? t('Исходящий') : t('Входящий')
  return duration
    ? t('{direction} · {kind} · {duration}', { direction, kind, duration })
    : t('{direction} · {kind}', { direction, kind })
}

/** Время записи: сегодня — «14:05», раньше — «16.09 14:05». */
export const callHistoryTime = (item: CallHistoryItem): string => {
  const date = new Date(item.timestamp)
  const today = new Date()
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  return sameDay ? formatMsgTime(item.timestamp) : formatChatTime(item.timestamp)
}

/** Строка-разделитель дня («Сегодня», «Вчера», «16 сентября»). */
export const callHistoryDay = (item: CallHistoryItem): string => dayLabel(new Date(item.timestamp))

/** Имя собеседника для экрана (пусто — покажем «Удалённый аккаунт»). */
export const callPeerName = (item: CallHistoryItem): string => {
  const peer = item.peer
  if (!peer) return t('Удалённый аккаунт')
  const name = [peer.first_name, peer.last_name].filter(Boolean).join(' ').trim()
  return name || peer.username || t('Без имени')
}

/** Фильтрует записи по выбранному фильтру (пустой фильтр — всё). */
export const filterCallHistory = (
  items: CallHistoryItem[],
  filter: CallFilterKey
): CallHistoryItem[] => items.filter((item) => matchesCallFilter(item, filter))
