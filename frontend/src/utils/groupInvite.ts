/**
 * Ссылка-приглашение в группу (`https://pismo.space/j/<токен>`).
 *
 * Ссылку делает создатель или админ группы в карточке группы и отправляет другу
 * любым способом — мессенджером, почтой, в чате. Открывший её попадает на
 * карточку группы и вступает в неё.
 *
 * Токен — случайная строка от сервера (`secrets.token_urlsafe`), поэтому в
 * ссылке нет ни названия группы, ни id: угадать чужую ссылку нельзя.
 *
 * Оригинал (origin) для ссылки берём из текущего адреса, а не из константы:
 * так ссылка работает и на проде (`pismo.space`), и в локальной разработке
 * (`localhost:5173`), где константа вела бы в интернет.
 *
 * Функции чистые (без обращения к `window`), поэтому по ним есть тесты.
 */

/** Префикс пути ссылки-приглашения. */
export const INVITE_LINK_PREFIX = '/j/'

/** Путь ссылки-приглашения по токену. */
export function invitePathFor(token: string | null | undefined): string | null {
  const value = (token ?? '').trim()
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  return `${INVITE_LINK_PREFIX}${value}`
}

/**
 * Токен из пути `/j/<токен>`; `null` — если это не ссылка-приглашение.
 *
 * Пустое значение и мусор отбрасываем сразу: серверу такой токен отправлять
 * незачем.
 */
export function inviteTokenFromPath(pathname: string): string | null {
  const match = /^\/j\/([^/]+)\/?$/.exec(pathname ?? '')
  if (!match) return null
  try {
    const token = decodeURIComponent(match[1] ?? '').trim()
    return /^[A-Za-z0-9_-]+$/.test(token) ? token : null
  } catch {
    // битый процентный код в адресе — это не ссылка-приглашение
    return null
  }
}

/**
 * Готовая ссылка для отправки: свой origin + путь ссылки.
 *
 * `origin` передаётся явно (обычно `window.location.origin`), чтобы функция
 * осталась чистой и тестируемой.
 */
export function inviteLinkFor(
  token: string | null | undefined,
  origin: string | null | undefined
): string | null {
  const path = invitePathFor(token)
  const base = (origin ?? '').replace(/\/+$/, '')
  return path && base ? `${base}${path}` : null
}
