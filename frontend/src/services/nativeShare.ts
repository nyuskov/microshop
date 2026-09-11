/**
 * «Поделиться» из системного меню Android внутрь Pismo.
 *
 * Приложение Android (`android/`) — это WebView, поэтому системное «Поделиться»
 * (ссылкой из браузера, текстом из заметок, картинкой из галереи) приходит в
 * нативную часть, а та передаёт содержимое веб-странице в два шага:
 *
 *  1. событие `pismo:share` — описание содержимого (текст, имя файла, mime, размер);
 *  2. байты файла страница забирает сама, по частям — `PismoNative.readShareChunk`
 *     (base64). Одним куском большая картинка не пролезла бы: вызов JS из
 *     нативной части ограничен по размеру и упал бы на «тяжёлом» файле.
 *
 * В браузере (PWA) приём извне устроен иначе и без нативной части: Chrome
 * открывает приложение по адресу с параметрами из `share_target` (см.
 * `utils/shareTarget.ts`). Исходящего «поделиться наружу» у нас нет намеренно:
 * своего пункта в системном меню Pismo не требует, а внутри приложения есть
 * «Переслать» и «Копировать».
 */

import { isNativeApp, nativeBridge } from './nativePush'

/** Сколько байт забираем из нативной части за один вызов (~256 КБ). */
export const SHARE_CHUNK_BYTES = 256 * 1024

/**
 * Больше этого размера не читаем: файл всё равно не загрузится (лимит загрузки
 * на сервере — 15 МБ), а в память страницы он попал бы целиком.
 */
export const MAX_SHARE_FILE_BYTES = 20 * 1024 * 1024

/** Что именно прислали через системное «Поделиться». */
export interface NativeShareDescriptor {
  /** Текст (для ссылки из браузера — сама ссылка). */
  text: string
  /** Тема письма/заголовок — некоторые приложения её передают. */
  subject: string
  /** MIME-тип файла (`image/jpeg`), пустая строка — если файла нет. */
  mime: string
  /** Имя файла из системного провайдера. */
  name: string
  /** Размер файла в байтах (0 — если файла нет). */
  size: number
  /** Есть ли присоединённый файл. */
  hasFile: boolean
}

/** Расширение по MIME-типу — для имени файла-заглушки. */
function extensionForMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif'
  }
  const subtype = (mime.split('/')[1] ?? '').split(/[;+]/)[0]
  return map[mime] ?? subtype ?? 'bin'
}

/**
 * Имя присланного файла с расширением.
 *
 * Провайдеры часто отдают имя без расширения (например, «1000012345»), а сервер
 * принимает вложения только с известным расширением — без него человек видел бы
 * «не удалось отправить». Поэтому расширение дописываем по MIME-типу.
 */
export function sharedFileName(name: string, mime: string): string {
  const trimmed = (name || '').trim()
  if (/\.[a-z0-9]{1,8}$/i.test(trimmed)) return trimmed
  return `${trimmed || 'shared'}.${extensionForMime(mime)}`
}

/** Приводит «сырые» данные (событие или ответ моста) к описанию. */
function toDescriptor(raw: unknown): NativeShareDescriptor | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const text = typeof value.text === 'string' ? value.text : ''
  const subject = typeof value.subject === 'string' ? value.subject : ''
  const mime = typeof value.mime === 'string' ? value.mime : ''
  const name = typeof value.name === 'string' ? value.name : ''
  const size = Number(value.size)
  // `hasFile` берём как есть: размер может быть неизвестен (0) — тогда файл всё
  // равно читаем, просто до конца (см. readNativeShareFile).
  const hasFile = value.hasFile === true
  if (!text.trim() && !hasFile) return null
  return {
    text,
    subject,
    mime,
    name,
    size: Number.isFinite(size) && size > 0 ? size : 0,
    hasFile
  }
}

/** Разбирает JSON от нативного слоя, не падая на мусоре. */
function parseJson(raw: string | undefined | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Спрашивает у нативного слоя, не ждёт ли страницу содержимое из «Поделиться».
 *
 * Нужно как страховка: событие могло прийти раньше, чем страница подписалась
 * (нативная часть отдаёт его после загрузки — но порядок лучше не предполагать).
 */
export function describeNativeShare(): NativeShareDescriptor | null {
  const bridge = nativeBridge()
  if (!bridge?.shareInfo) return null
  return toDescriptor(parseJson(bridge.shareInfo()))
}

/** base64 → байты (без Node-буферов: код исполняется в браузере). */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Забирает присоединённый файл из нативной части частями и собирает `File`,
 * который можно сразу отправить в чат (как обычное вложение).
 *
 * Возвращает `null`, если файла нет или он больше `MAX_SHARE_FILE_BYTES`.
 */
export async function readNativeShareFile(descriptor: NativeShareDescriptor): Promise<File | null> {
  const bridge = nativeBridge()
  if (!descriptor.hasFile || !bridge?.readShareChunk) return null
  if (descriptor.size > MAX_SHARE_FILE_BYTES) return null

  const parts: Uint8Array[] = []
  let assembled = 0
  // Идём по фактически собранному размеру, а не по шагу: последний кусок
  // короче остальных, и «прыжок» на SHARE_CHUNK_BYTES потерял бы конец файла.
  while (descriptor.size === 0 || assembled < descriptor.size) {
    const chunk = bridge.readShareChunk(assembled, SHARE_CHUNK_BYTES) ?? ''
    if (!chunk) break
    const bytes = base64ToBytes(chunk)
    if (!bytes.length) break
    parts.push(bytes)
    assembled += bytes.length
  }
  if (!parts.length) return null

  const mime = descriptor.mime || 'application/octet-stream'
  const name = sharedFileName(descriptor.name, mime)
  return new File(parts, name, { type: mime })
}

/** Освобождает содержимое в нативной части (после отправки или отмены). */
export function clearNativeShare(): void {
  nativeBridge()?.clearShare?.()
}

/**
 * Подписывается на «поделиться» из системного меню. Возвращает функцию отписки;
 * в браузере — no-op.
 */
export function initNativeShare(onShare: (descriptor: NativeShareDescriptor) => void): () => void {
  if (!isNativeApp() || typeof window === 'undefined') return () => {}

  const listener = (event: Event): void => {
    const descriptor = toDescriptor((event as CustomEvent<unknown>).detail)
    if (descriptor) onShare(descriptor)
  }
  window.addEventListener('pismo:share', listener)

  // Страница могла загрузиться уже после того, как человек нажал «Поделиться».
  const pending = describeNativeShare()
  if (pending) onShare(pending)

  return () => window.removeEventListener('pismo:share', listener)
}
