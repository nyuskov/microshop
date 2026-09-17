/**
 * История звонков: запрос к серверу.
 *
 * Записей о звонках нет отдельной таблицей — сервер собирает их из системных
 * сообщений личного чата (`kind='call'`), поэтому здесь тот же формат страниц,
 * что и у ленты сообщений: `limit`/`offset` и общее число `total`.
 */
import { api } from '@/services/api'
import type { CallHistoryItem, CallHistoryPage } from '@/utils/callHistory'

/** Сколько записей просим за раз (столько же отдаёт сервер по умолчанию). */
export const CALL_HISTORY_PAGE = 50

export const fetchCallHistory = async (
  params: { limit?: number; offset?: number } = {}
): Promise<CallHistoryPage> => {
  const response = await api.get<{ items: CallHistoryItem[]; total: number }>('/calls/history/', {
    params: {
      limit: params.limit ?? CALL_HISTORY_PAGE,
      offset: params.offset ?? 0
    }
  })
  return {
    items: response.data?.items ?? [],
    total: response.data?.total ?? 0
  }
}
