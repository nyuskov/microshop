/**
 * Ссылка-канал (`https://pismo.space/c/<адрес>`) и её разбор.
 *
 * Адрес канала (`channel_username`) уникален в базе и виден только у публичных
 * каналов: именно он — публичный ключ ссылки, как логин у ссылки-профиля
 * (см. `profileLink.ts`). Приватный канал по ссылке не найдётся — вход только по
 * приглашению.
 *
 * Правила адреса — общие с сервером (`backend/api_v1/channels/crud.py`):
 * латиница, цифры и подчёркивание, 4–32 символа, начинается с буквы.
 *
 * Функции чистые (без обращения к `window`), поэтому по ним есть отдельные тесты.
 */
import { PROFILE_LINK_ORIGIN } from '@/utils/profileLink'

/** Префикс пути ссылки на канал. */
export const CHANNEL_LINK_PREFIX = '/c/'

/** Допустимый адрес канала: тот же шаблон, что и на сервере. */
const CHANNEL_ALIAS_RE = /^[a-z][a-z0-9_]{3,31}$/

/** Приводит адрес к каноническому виду (`@Имя` → `имя`, нижний регистр). */
export function normalizeChannelUsername(username: string | null | undefined): string | null {
  const alias = (username ?? '').trim().replace(/^@+/, '').toLowerCase()
  return alias || null
}

/** Проверяет адрес по правилам сервера. */
export function isValidChannelUsername(username: string | null | undefined): boolean {
  const alias = normalizeChannelUsername(username)
  return alias !== null && CHANNEL_ALIAS_RE.test(alias)
}

/** Ссылка на канал по адресу; `null` — если адрес недопустимый или его нет. */
export function channelLinkFor(username: string | null | undefined): string | null {
  const alias = normalizeChannelUsername(username)
  if (!alias || !CHANNEL_ALIAS_RE.test(alias)) return null
  return `${PROFILE_LINK_ORIGIN}${CHANNEL_LINK_PREFIX}${alias}`
}

/** Адрес канала из пути `/c/<адрес>`; `null` — если это не ссылка на канал. */
export function channelUsernameFromPath(pathname: string): string | null {
  const match = /^\/c\/([^/]+)\/?$/.exec(pathname ?? '')
  if (!match) return null
  try {
    const alias = normalizeChannelUsername(decodeURIComponent(match[1] ?? ''))
    return alias && CHANNEL_ALIAS_RE.test(alias) ? alias : null
  } catch {
    // битый процентный код в адресе — это не ссылка на канал
    return null
  }
}
