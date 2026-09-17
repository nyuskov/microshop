/**
 * Проверка связи с сервером (маяк «есть интернет или нет»).
 *
 * Зачем отдельный запрос: события браузера `online`/`offline` отражают только
 * наличие сетевого интерфейса. Мобильные сети, VPN, «каптивный» Wi-Fi и падение
 * провайдера дают ситуацию «интерфейс есть, интернета нет» — и наоборот,
 * `online` приходит не всегда, поэтому плашка «нет сети» могла висеть вечно.
 * Единственный честный признак — ответ сервера, поэтому приложение пингует
 * публичный `/system/ping/`.
 *
 * Запрос идёт через `fetch`, а не через общий axios-клиент: маяк должен быть
 * независим от интерцепторов (техработы, refresh-токена) и иметь короткий
 * таймаут — иначе «проверка» зависала бы на 15 секунд.
 */

import { API_BASE_URL } from '@/config'

/** Сколько ждём ответ маяка, прежде чем считать, что связи нет. */
export const PING_TIMEOUT_MS = 4000

/**
 * Есть ли связь с сервером.
 *
 * Успешным считается ЛЮБОЙ полученный ответ, включая 4xx/5xx: он доказывает,
 * что пакет дошёл и вернулся. Сервер может быть в техработах или падать — это
 * забота других экранов, а не плашки «нет интернета».
 */
export async function pingServer(timeoutMs: number = PING_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(`${API_BASE_URL}/system/ping/?t=${Date.now()}`, {
      method: 'GET',
      // Ответ не кэшируем: значение маяка — «прямо сейчас», а не «когда-то».
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
