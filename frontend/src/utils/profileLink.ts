/**
 * Ссылка-профиль (`https://pismo.space/u/<логин>`) и её разбор.
 *
 * Логин (`username`) уникален в базе, поэтому именно он — публичный ключ ссылки.
 * Номер телефона в ссылку не попадает: такую ссылку можно спокойно переслать в
 * другой мессенджер или опубликовать.
 *
 * Функции чистые (без обращения к `window`), поэтому по ним есть отдельные тесты.
 */

/** Домен, на который ведут публичные ссылки (он же в Android App Links). */
export const PROFILE_LINK_ORIGIN = 'https://pismo.space'

/** Префикс пути ссылки-профиля. */
export const PROFILE_LINK_PREFIX = '/u/'

/** Приводит логин к каноническому виду (`@Имя` → `имя`). */
export function normalizeUsername(username: string | null | undefined): string | null {
  const name = (username ?? '').trim().replace(/^@+/, '')
  return name || null
}

/** Ссылка-профиль по логину; `null` — если логина нет. */
export function profileLinkFor(username: string | null | undefined): string | null {
  const name = normalizeUsername(username)
  if (!name) return null
  return `${PROFILE_LINK_ORIGIN}${PROFILE_LINK_PREFIX}${encodeURIComponent(name)}`
}

/** Логин из пути `/u/<логин>`; `null` — если это не ссылка-профиль. */
export function usernameFromProfilePath(pathname: string): string | null {
  const match = /^\/u\/([^/]+)\/?$/.exec(pathname ?? '')
  if (!match) return null
  try {
    return normalizeUsername(decodeURIComponent(match?.[1] ?? ''))
  } catch {
    // битый процентный код в адресе — это не ссылка-профиль
    return null
  }
}

/** Текст для системного «Поделиться» (короткое пояснение + ссылка). */
export function profileShareText(link: string, name?: string | null): string {
  const title = (name ?? '').trim()
  return title ? `${title} — в Pismo: ${link}` : `Я в Pismo: ${link}`
}
