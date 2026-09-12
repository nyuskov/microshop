/**
 * Кэш расшифрованных вложений E2EE.
 *
 * Зашифрованный файл лежит на сервере как обычный `/media/...` — его нужно
 * скачать, расшифровать ключом из конверта и превратить в `blob:`-ссылку,
 * которую уже понимают `<img>`, `<video>` и `<audio>`.
 *
 * Состояние хранится по id сообщения, поэтому файл расшифровывается один раз,
 * сколько бы раз ни перерисовалась строка (и сколько бы раз ни открывали
 * «Информацию о чате»).
 */

import { reactive } from 'vue'
import { mediaUrl } from '@/config'
import type { Message } from '@/types'
import { decryptFileBlob } from '@/services/e2eeFiles'

export type DecryptedStatus = 'loading' | 'ready' | 'failed'

export interface DecryptedMedia {
  status: DecryptedStatus
  /** `blob:`-ссылка (только при `status === 'ready'`). */
  url: string
  name: string
  mime: string
  size: number
}

const cache = reactive<Record<number, DecryptedMedia | undefined>>({})
const inflight = new Set<number>()

export interface DecryptedMediaOptions {
  /**
   * Можно ли начинать загрузку. По умолчанию — сразу.
   *
   * Строка передаёт сюда «я показалась на экране» (`useVisibleOnce`): иначе при
   * открытии чата скачивались бы и расшифровывались вложения всей загруженной
   * истории — а это и трафик, и AES на каждое вложение, и blob-ссылки в памяти.
   */
  enabled?: () => boolean
}

/**
 * Расшифрованное вложение сообщения или null, если вложение не зашифровано.
 *
 * Возвращает запись сразу (пока файл не готов — статус `loading`), а загрузку
 * начинает, только если это разрешено. Важно: при «не разрешено» отдаём именно
 * запись в статусе `loading`, а не null — иначе разметка возьмёт исходный
 * шифротекст и покажет его как обычное вложение.
 */
export function decryptedMediaFor(
  message: Message,
  options: DecryptedMediaOptions = {}
): DecryptedMedia | null {
  const meta = message.e2ee_file
  const file = message.file
  if (!meta || !file) return null
  const canLoad = options.enabled === undefined || options.enabled()

  const cached = cache[message.id]
  if (cached) {
    // Загрузку могли отложить до появления на экране — самое время начать.
    if (cached.status === 'loading' && canLoad) void load(message)
    return cached
  }
  cache[message.id] = {
    status: 'loading',
    url: '',
    name: meta.n,
    mime: meta.m,
    size: meta.s
  }
  if (canLoad) void load(message)
  return cache[message.id] ?? null
}

async function load(message: Message): Promise<void> {
  const meta = message.e2ee_file
  const file = message.file
  if (!meta || !file || inflight.has(message.id)) return
  inflight.add(message.id)
  try {
    // `/media/...` отдаётся статикой, авторизация для него не нужна.
    const response = await fetch(mediaUrl(file.url))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await decryptFileBlob(meta, await response.arrayBuffer())
    if (!blob) throw new Error('Не удалось расшифровать')
    cache[message.id] = {
      status: 'ready',
      url: URL.createObjectURL(blob),
      name: meta.n,
      mime: meta.m,
      size: meta.s
    }
  } catch {
    cache[message.id] = {
      status: 'failed',
      url: '',
      name: meta.n,
      mime: meta.m,
      size: meta.s
    }
  } finally {
    inflight.delete(message.id)
  }
}

/** Догружает вложения, у которых уже есть конверт (лайтбокс, галерея чата). */
export function preloadDecryptedMedia(messages: Message[]): void {
  for (const message of messages) {
    if (message.e2ee_file) void decryptedMediaFor(message)
  }
}

/** Освобождает `blob:`-ссылки. Без аргумента — все (например, при выходе). */
export function releaseDecryptedMedia(messageIds?: Iterable<number>): void {
  const ids = messageIds ? Array.from(messageIds) : Object.keys(cache).map(Number)
  for (const id of ids) {
    const item = cache[id]
    if (item?.url) URL.revokeObjectURL(item.url)
    delete cache[id]
  }
}

/** Освобождает всё, что не относится к указанным сообщениям (смена чата). */
export function releaseDecryptedMediaExcept(keepIds: Iterable<number>): void {
  const keep = new Set(keepIds)
  releaseDecryptedMedia(
    Object.keys(cache)
      .map(Number)
      .filter((id) => !keep.has(id))
  )
}
