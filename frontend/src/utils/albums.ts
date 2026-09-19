/**
 * Альбомы: несколько картинок одной отправки.
 *
 * Такие сообщения хранят общую метку `album_id` (см.
 * `api_v1/messages/crud.send_attachment_message`), а группировку рисует клиент:
 * лента показывает пачку ОДНОЙ сеткой, а не «простынёй» из картинок.
 *
 * Здесь обе стороны одной договорённости:
 *  1. как разложить выбранные файлы на отправку (`planFileSend`) — подряд идущие
 *     картинки уходят одним альбомом, а документы и записи остаются отдельными
 *     сообщениями (сетка рассчитана только на картинки);
 *  2. как собрать альбомы из пришедшей ленты (`albumLayout`) — сетку рисует
 *     головное сообщение, остальные части пачки отдельными строками не выводятся.
 */

import type { Message } from '@/types'
import type { MessageRow } from '@/utils/thread'

/** Сколько вложений допускается в одном альбоме (то же число на сервере). */
export const ALBUM_MAX_ITEMS = 10

/** С одной картинкой альбом не нужен: это обычное сообщение. */
export const ALBUM_MIN_ITEMS = 2

/** Метка альбома: её придумывает клиент, сервер только хранит её. */
export const newAlbumId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** В альбом собираем только картинки: видео и записи идут отдельной строкой. */
export const isAlbumImage = (file: File): boolean => file.type.startsWith('image/')

/** Что отправляем одним действием: альбом из картинок либо одиночный файл. */
export type SendPlanItem = { kind: 'album'; files: File[] } | { kind: 'file'; file: File }

/**
 * Раскладывает выбранные файлы на отправку, сохраняя их порядок.
 *
 * Правила (как в мессенджерах): подряд идущие картинки собираются в альбом до
 * `ALBUM_MAX_ITEMS`, любой другой файл альбом ЗАКРЫВАЕТ и уходит своим
 * сообщением. Одна картинка альбомом не считается — иначе в ленте появился бы
 * «альбом из одного фото», а это просто картинка.
 *
 * `allowAlbums=false` («посмотреть один раз») оставляет всё одиночными
 * сообщениями: одноразовое вложение и альбом несовместимы, сервер отвечает 400.
 */
export const planFileSend = (files: File[], allowAlbums = true): SendPlanItem[] => {
  const plan: SendPlanItem[] = []
  let batch: File[] = []

  const flush = (): void => {
    if (batch.length >= ALBUM_MIN_ITEMS) plan.push({ kind: 'album', files: batch })
    else for (const file of batch) plan.push({ kind: 'file', file })
    batch = []
  }

  for (const file of files) {
    if (allowAlbums && isAlbumImage(file)) {
      batch.push(file)
      if (batch.length >= ALBUM_MAX_ITEMS) flush()
      continue
    }
    flush()
    plan.push({ kind: 'file', file })
  }
  flush()
  return plan
}

export interface AlbumLayout {
  /** Головное сообщение → все вложения пачки (в порядке ленты). */
  members: Map<number, Message[]>
  /** Любое сообщение пачки → id головного (у одиночного — собственный id). */
  headOf: Map<number, number>
  /** Продолжения пачки: отдельными строками ленты не рисуются. */
  continuations: Set<number>
}

/**
 * Собирает альбомы из строк ленты.
 *
 * Альбомом считаем ТОЛЬКО подряд идущие сообщения одного автора с одной меткой:
 * если между частями вклинилось чужое сообщение (или метка по какой-то причине
 * совпала), пачка начинается заново — так лента не склеит разные отправки.
 *
 * Удалённая голова альбома не ломает показ: первой доступной части просто
 * достаётся роль головной, и сетка рисуется из того, что осталось.
 */
export const albumLayout = (rows: MessageRow[]): AlbumLayout => {
  const members = new Map<number, Message[]>()
  const headOf = new Map<number, number>()
  const continuations = new Set<number>()
  let current: Message | null = null

  for (const row of rows) {
    if (row.kind !== 'message') continue
    const message = row.message
    headOf.set(message.id, message.id)
    if (!message.album_id) {
      current = null
      continue
    }
    if (
      current &&
      current.album_id === message.album_id &&
      current.user_id === message.user_id &&
      current.chat_id === message.chat_id
    ) {
      members.get(current.id)?.push(message)
      headOf.set(message.id, current.id)
      continuations.add(message.id)
      continue
    }
    current = message
    members.set(message.id, [message])
  }
  return { members, headOf, continuations }
}
