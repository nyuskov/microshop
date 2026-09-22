import { t } from '@/i18n'
/**
 * Резервная копия ключа шифрования (E2EE).
 *
 * Зачем: приватный ключ устройства живёт только в `localStorage` браузера.
 * Переустановил приложение, почистил данные, потерял телефон — и вся переписка
 * в зашифрованных чатах становится нечитаемой: сервер её расшифровать не может
 * (в этом и смысл сквозного шифрования), а второго экземпляра ключа нигде нет.
 * Мультиустройство (A5) закрывает случай «телефон и ноутбук», но не потерю
 * устройства.
 *
 * Формат файла — JSON: ключ устройства (приватный + публичный + метка
 * устройства) лежит внутри AES-GCM, а ключ шифрования выводится из парольной
 * фразы через PBKDF2-SHA256. Поэтому файл без фразы бесполезен, а фраза без
 * файла — тем более. Ничего автоматического: копию человек делает сам, явно, с
 * предупреждением (см. `components/messenger/E2eeBackupDialog.vue`).
 */

import {
  bytesFromB64,
  bytesToB64,
  installKeyMaterial,
  isE2eeAvailable,
  myKeyMaterial,
  randomBytes,
  type DeviceKeyMaterial
} from './e2ee'

/** Метка формата: по ней отличаем свой файл от чужого/повреждённого. */
export const BACKUP_FORMAT = 'pismo-e2ee-backup'

/** Версия формата: при несовместимых правках увеличиваем и отказываем старым. */
export const BACKUP_VERSION = 1

/** Сколько итераций PBKDF2: на телефоне это заметная, но приемлемая пауза. */
export const BACKUP_ITERATIONS = 210_000

/** Границы итераций для чтения чужого файла: защита от «файла на миллиард». */
const MIN_ITERATIONS = 10_000
const MAX_ITERATIONS = 2_000_000

const SALT_BYTES = 16
const IV_BYTES = 12

/** Минимальная длина парольной фразы: короче — уже перебор, а не защита. */
export const MIN_PASSPHRASE_LENGTH = 8

const te = new TextEncoder()

export interface BackupFile {
  format: string
  version: number
  /** Чей это ключ: копию нельзя восстановить в другой аккаунт. */
  user_id: number
  device_id: string
  created_at: string
  kdf: { name: string; hash: string; iterations: number; salt: string }
  cipher: { name: string; iv: string }
  /** Зашифрованный ключ устройства (`DeviceKeyMaterial`), base64. */
  data: string
}

const isBackupFile = (value: unknown): value is BackupFile => {
  const file = value as Partial<BackupFile> | null
  return (
    !!file &&
    file.format === BACKUP_FORMAT &&
    typeof file.user_id === 'number' &&
    typeof file.kdf?.salt === 'string' &&
    typeof file.kdf?.iterations === 'number' &&
    typeof file.cipher?.iv === 'string' &&
    typeof file.data === 'string'
  )
}

const assertPassphrase = (passphrase: string): void => {
  if (passphrase.trim().length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(t('Парольная фраза короче {count} символов', { count: MIN_PASSPHRASE_LENGTH }))
  }
}

/** Ключ AES-GCM из парольной фразы: PBKDF2-SHA256, соль из файла. */
async function passphraseKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te.encode(passphrase), 'PBKDF2', false, [
    'deriveKey'
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Имя файла копии: по нему видно, чей ключ и когда снят. */
export const backupFileName = (userId: number, date = new Date()): string =>
  `pismo-key-${userId}-${date.toISOString().slice(0, 10)}.json`

/**
 * Собирает резервную копию: ключ устройства под парольной фразой.
 *
 * Возвращает готовый текст файла (его сохраняет интерфейс).
 */
export async function createBackup(userId: number, passphrase: string): Promise<string> {
  if (!isE2eeAvailable()) throw new Error(t('Шифрование в этом браузере недоступно'))
  assertPassphrase(passphrase)
  const material = await myKeyMaterial(userId)
  if (!material) {
    throw new Error(t('Ключ устройства не найден — в этом браузере шифрование ещё не включалось'))
  }
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await passphraseKey(passphrase, salt, BACKUP_ITERATIONS)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    te.encode(JSON.stringify(material))
  )
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    user_id: userId,
    device_id: material.device_id,
    created_at: new Date().toISOString(),
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: BACKUP_ITERATIONS,
      salt: bytesToB64(salt)
    },
    cipher: { name: 'AES-GCM', iv: bytesToB64(iv) },
    data: bytesToB64(new Uint8Array(cipher))
  }
  return JSON.stringify(file, null, 2)
}

/**
 * Восстанавливает ключ устройства из резервной копии.
 *
 * После успеха ключ заменяет текущий: приложение должно перечитать чаты (в
 * интерфейсе для этого есть перезапуск), иначе на экране останется то, что было
 * расшифровано прежним ключом.
 */
export async function restoreBackup(
  userId: number,
  text: string,
  passphrase: string
): Promise<{ deviceId: string }> {
  if (!isE2eeAvailable()) throw new Error(t('Шифрование в этом браузере недоступно'))
  assertPassphrase(passphrase)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(t('Это не файл резервной копии (не читается как JSON)'))
  }
  if (!isBackupFile(parsed)) {
    throw new Error(t('Это не файл резервной копии Pismo или он повреждён'))
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error(t('Копия сделана более новой версией приложения — обновите приложение'))
  }
  if (parsed.user_id !== userId) {
    throw new Error(t('Копия сделана для другого аккаунта — войдите в него и повторите'))
  }
  const iterations = Math.min(
    MAX_ITERATIONS,
    Math.max(MIN_ITERATIONS, Math.trunc(parsed.kdf.iterations))
  )
  const key = await passphraseKey(passphrase, bytesFromB64(parsed.kdf.salt), iterations)

  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytesFromB64(parsed.cipher.iv) },
      key,
      bytesFromB64(parsed.data)
    )
  } catch {
    // GCM не сошёлся — либо фраза не та, либо файл правили.
    throw new Error(t('Не подошла парольная фраза (или файл повреждён)'))
  }

  let material: DeviceKeyMaterial
  try {
    material = JSON.parse(new TextDecoder().decode(plain)) as DeviceKeyMaterial
  } catch {
    throw new Error(t('Внутри копии не ключ устройства — файл повреждён'))
  }
  if (!material?.priv?.d || !material?.pub?.x) {
    throw new Error(t('Внутри копии неполный ключ устройства — файл повреждён'))
  }
  await installKeyMaterial(userId, material)
  return { deviceId: material.device_id }
}
