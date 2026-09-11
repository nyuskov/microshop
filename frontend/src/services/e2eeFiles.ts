/**
 * Шифрование вложений (E2EE).
 *
 * Файл шифруется отдельным случайным ключом (AES-GCM), а сам ключ вместе с
 * настоящим именем/типом/размером/подписью складывается в «конверт». Конверт
 * шифруется ключом чата и уходит в текст сообщения — то есть и содержимое
 * файла, и его имя на сервере зашифрованы. Сервер видит только шифротекст и
 * нейтральное имя `enc_<hex>.bin`.
 *
 * Формат конверта — `EncryptedFileMeta` (см. `@/types`).
 */

import type { EncryptedFileMeta } from '@/types'
import {
  GROUP_KEY_BYTES,
  bytesFromB64,
  bytesToB64,
  decryptBytes,
  encryptBytes,
  encryptText,
  importRawAesKey,
  randomBytes
} from './e2ee'

/** MIME шифротекста: настоящий тип файла знает только получатель. */
export const ENCRYPTED_BLOB_MIME = 'application/octet-stream'

/**
 * Нейтральное имя файла-шифротекста. Своё расширение не ставим осознанно:
 * сервер не должен решать, чем является блоб, а браузер — пытаться его открыть.
 */
export function encryptedBlobName(): string {
  const hex = Array.from(randomBytes(8))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `enc_${hex}.bin`
}

export interface EncryptedFilePayload {
  /** Шифротекст файла — именно его отправляем на сервер. */
  blob: File
  /** Зашифрованный конверт — уходит в текст сообщения. */
  text: string
  meta: EncryptedFileMeta
}

/** Шифрует файл под ключ чата (ключа чата: личного или группового). */
export async function encryptFileForChat(
  chatKey: CryptoKey,
  file: File,
  caption = ''
): Promise<EncryptedFilePayload> {
  const raw = randomBytes(GROUP_KEY_BYTES)
  const fileKey = await importRawAesKey(raw)
  const { iv, data } = await encryptBytes(fileKey, await file.arrayBuffer())
  const meta: EncryptedFileMeta = {
    v: 1,
    t: 'file',
    n: file.name || 'file',
    m: file.type || ENCRYPTED_BLOB_MIME,
    s: file.size,
    k: bytesToB64(raw),
    i: iv
  }
  const trimmed = caption.trim()
  if (trimmed) meta.c = trimmed
  const text = await encryptText(chatKey, JSON.stringify(meta))
  const blob = new File([data], encryptedBlobName(), { type: ENCRYPTED_BLOB_MIME })
  return { blob, text, meta }
}

/**
 * Разбирает расшифрованный текст сообщения: если это конверт вложения —
 * возвращает его, иначе null (обычный текст).
 */
export function parseFileMeta(plain: string): EncryptedFileMeta | null {
  const trimmed = plain.trim()
  // Быстрая отсечка: конверт — всегда JSON с полем t:"file".
  if (!trimmed.startsWith('{') || !trimmed.includes('"t"')) return null
  try {
    const parsed = JSON.parse(trimmed) as Partial<EncryptedFileMeta>
    if (parsed?.t !== 'file' || !parsed.k || !parsed.i || !parsed.n) return null
    const meta: EncryptedFileMeta = {
      v: 1,
      t: 'file',
      n: String(parsed.n),
      m: String(parsed.m ?? ENCRYPTED_BLOB_MIME),
      s: Number(parsed.s ?? 0),
      k: String(parsed.k),
      i: String(parsed.i)
    }
    if (parsed.c) meta.c = String(parsed.c)
    return meta
  } catch {
    return null
  }
}

/** Расшифровывает шифротекст вложения в Blob (для показа и скачивания). */
export async function decryptFileBlob(
  meta: EncryptedFileMeta,
  cipher: ArrayBuffer
): Promise<Blob | null> {
  const key = await importRawAesKey(bytesFromB64(meta.k))
  const plain = await decryptBytes(key, meta.i, cipher)
  if (!plain) return null
  return new Blob([plain], { type: meta.m || ENCRYPTED_BLOB_MIME })
}

/** Подпись к вложению из конверта (пустая строка, если подписи не было). */
export const fileCaption = (meta: EncryptedFileMeta | null | undefined): string =>
  meta?.c?.trim() ?? ''
