/**
 * Модерация пользовательского контента: жалобы, блокировки, удаление аккаунта.
 *
 * Требования RuStore к приложениям с пользовательским контентом (UGC):
 * сообщить о неприемлемом контенте, заблокировать нарушителя и удалить аккаунт.
 */

import { api } from './api'
import type { SearchUserResult } from './chatService'

export type ReportReason = 'spam' | 'abuse' | 'fraud' | 'violence' | 'other'

/** Причины жалобы (значения должны совпадать с REPORT_REASONS на сервере). */
export const REPORT_REASONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: 'Спам или реклама' },
  { value: 'abuse', label: 'Оскорбления и травля' },
  { value: 'fraud', label: 'Мошенничество' },
  { value: 'violence', label: 'Угрозы и насилие' },
  { value: 'other', label: 'Другое' }
]

/** Строка-подтверждение удаления аккаунта (та же проверка на сервере). */
export const DELETE_ACCOUNT_CONFIRM = 'УДАЛИТЬ'

export interface ReportPayload {
  /** На кого жалуемся. */
  userId: number
  reason: ReportReason
  comment?: string
  /** Диалог, в котором произошло нарушение (контекст для модератора). */
  chatId?: number
  /** Конкретное сообщение (если жалоба на него). */
  messageId?: number
}

/** Отправляет жалобу на пользователя/сообщение. */
export async function reportUser(payload: ReportPayload): Promise<void> {
  await api.post('/moderation/reports/', {
    user_id: payload.userId,
    reason: payload.reason,
    comment: payload.comment?.trim() || null,
    chat_id: payload.messageId ? null : (payload.chatId ?? null),
    message_id: payload.messageId ?? null
  })
}

/** Состояние блокировки: стоит ли и какого она вида. */
export interface BlockState {
  blocked: boolean
  /** true — «только звонки»: переписка идёт, дозвон запрещён. */
  messagesAllowed: boolean
}

/** Заблокированный пользователь в списке (с видом блокировки). */
export interface BlockedUser extends SearchUserResult {
  messages_allowed: boolean
}

/**
 * Блокирует пользователя.
 *
 * По умолчанию — полная блокировка: он не сможет писать, диалог скрывается.
 * С `messagesAllowed` — мягкая («только звонки»): переписка и чат остаются,
 * запрещён дозвон. Нужна чаще, чем полная: человек не хочет звонков от
 * знакомого, но не собирается вычёркивать его из переписки.
 */
export async function blockUser(
  userId: number,
  options?: { messagesAllowed?: boolean }
): Promise<BlockState> {
  const { data } = await api.put<{ blocked: boolean; messages_allowed: boolean }>(
    `/moderation/blocks/${userId}/`,
    { messages_allowed: options?.messagesAllowed ?? false }
  )
  return { blocked: data.blocked, messagesAllowed: data.messages_allowed }
}

/** Снимает блокировку. */
export async function unblockUser(userId: number): Promise<void> {
  await api.delete(`/moderation/blocks/${userId}/`)
}

/**
 * Своя блокировка этого пользователя (для подписей в меню чата).
 *
 * Рассказываем только про СВОЮ блокировку — чужая не наше дело.
 */
export async function fetchBlockState(userId: number): Promise<BlockState> {
  const { data } = await api.get<{ blocked: boolean; messages_allowed: boolean }>(
    `/moderation/blocks/${userId}/`
  )
  return { blocked: data.blocked, messagesAllowed: data.messages_allowed }
}

/** Список заблокированных пользователей (с видом блокировки). */
export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const { data } = await api.get<BlockedUser[]>('/moderation/blocks/')
  return data
}

/**
 * Безвозвратно удаляет аккаунт текущего пользователя.
 *
 * Нужен и пароль аккаунта, и подтверждающая строка — сервер проверяет оба.
 */
export async function deleteAccount(password: string): Promise<void> {
  await api.request({
    method: 'DELETE',
    url: '/users/me/',
    data: { password, confirm: DELETE_ACCOUNT_CONFIRM }
  })
}

// ---------- Разбор жалоб (только администраторы) ----------

/** Статус разбора жалобы (значения совпадают с REPORT_STATUSES на сервере). */
export type ReportStatus = 'new' | 'in_review' | 'resolved' | 'rejected'

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  new: 'Новая',
  in_review: 'В работе',
  resolved: 'Решена',
  rejected: 'Отклонена'
}

/** Жалоба в том виде, в каком её видит модератор. */
export interface ModerationReport {
  id: number
  reporter_id: number
  reporter_name: string | null
  reporter_phone: string | null
  reported_id: number
  reported_name: string | null
  reported_phone: string | null
  reason: ReportReason
  comment: string | null
  chat_id: number | null
  message_id: number | null
  /** Текст сообщения, на которое пожаловались (обрезан сервером до 300 симв.). */
  message_text: string | null
  status: ReportStatus
  note: string | null
  created_at: string
  reviewed_at: string | null
}

export interface ReportListResponse {
  total: number
  items: ModerationReport[]
}

/** Подпись причины жалобы (для карточки модератора). */
export function reportReasonLabel(reason: ReportReason): string {
  return REPORT_REASONS.find((item) => item.value === reason)?.label ?? reason
}

/** Список жалоб для разбора (админ). Без фильтра — все, свежие первыми. */
export async function fetchReports(params?: {
  status?: ReportStatus
  reason?: ReportReason
  limit?: number
  offset?: number
}): Promise<ReportListResponse> {
  const { data } = await api.get<ReportListResponse>('/moderation/reports/', { params })
  return data
}

/** Меняет статус разбора жалобы (и, при желании, оставляет заметку). */
export async function updateReportStatus(
  reportId: number,
  status: ReportStatus,
  note?: string
): Promise<ModerationReport> {
  const { data } = await api.patch<ModerationReport>(`/moderation/reports/${reportId}/`, {
    status,
    note: note ?? null
  })
  return data
}

/** Одна запись журнала модерации (кто/что/когда). */
export interface ModerationJournalEntry {
  id: number
  action: string
  /** null — действие автоматики (авто-скрытие по жалобам). */
  moderator_id: number | null
  target_user_id: number | null
  report_id: number | null
  message_id: number | null
  note: string
  created_at: string
}

export interface ModerationJournalResponse {
  total: number
  /** Сколько сообщений скрыто прямо сейчас. */
  hidden_messages: number
  items: ModerationJournalEntry[]
}

/** Подписи действий журнала (значения — из core/models/moderation_action.py). */
export const JOURNAL_ACTION_LABELS: Record<string, string> = {
  report_created: 'Жалоба отправлена',
  message_auto_hidden: 'Авто-скрытие по жалобам',
  report_status_changed: 'Решение по жалобе',
  message_hidden: 'Сообщение скрыто модератором',
  message_restored: 'Сообщение восстановлено'
}

/** Журнал модерации (админ): доказательство разбора UGC и разбор споров. */
export async function fetchJournal(params?: {
  limit?: number
  offset?: number
}): Promise<ModerationJournalResponse> {
  const { data } = await api.get<ModerationJournalResponse>('/moderation/journal/', {
    params
  })
  return data
}

/** Снимает скрытие со всех сообщений автора (жалобы оказались ложными). */
export async function unhideUserMessages(userId: number): Promise<number> {
  const { data } = await api.post<{ restored: number }>(`/moderation/users/${userId}/unhide/`)
  return data.restored ?? 0
}
