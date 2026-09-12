import { api } from '@/services/api'

/**
 * Проверка «этот звонок ещё ждёт меня?».
 *
 * Экран «Входящий звонок…» открывается по push-уведомлению, пока сигнальный
 * канал ещё поднимается: сам вызов лежит в парковке на сервере (`park_offer`).
 * Уведомление может быть устаревшим — звонок давно отклонили, приняли на другом
 * устройстве или зовущий его отменил. Тогда парковки уже нет, и показывать
 * «Входящий звонок…» до таймаута нельзя: человек ждёт звонка, которого нет.
 *
 * `null` означает «не знаем» (нет сети или ошибка сервера): в этом случае экран
 * не трогаем — пусть работает обычное ожидание.
 */
export async function isCallStillPending(callId: string): Promise<boolean | null> {
  if (!callId) return false
  try {
    const { data } = await api.get<{ pending: boolean }>('/calls/pending/', {
      params: { call_id: callId }
    })
    return data?.pending === true
  } catch {
    return null
  }
}
