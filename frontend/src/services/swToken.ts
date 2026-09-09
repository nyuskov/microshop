/**
 * Дублирует access-токен в CacheStorage, доступный service worker'у.
 *
 * Service worker не имеет доступа к localStorage страницы, а кнопки
 * push-уведомлений («Отклонить», «Пометить как прочитанное») должны уметь
 * делать запросы на сервер без открытия приложения. Токен кладём в
 * отдельный кэш под фиксированным ключом; SW читает его при клике по кнопке.
 */

const AUTH_CACHE = 'microshop-auth'
const TOKEN_URL = '/__auth_token'

/** Сохраняет (или удаляет) токен для service worker. */
export async function saveSwToken(token: string | null): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open(AUTH_CACHE)
    if (token) {
      await cache.put(TOKEN_URL, new Response(token))
    } else {
      await cache.delete(TOKEN_URL)
    }
  } catch {
    /* кеш недоступен — кнопки уведомлений будут просто открывать приложение */
  }
}
