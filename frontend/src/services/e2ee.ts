/**
 * Сквозное шифрование (Этап 1): ключи на устройство, без forward secrecy.
 *
 * - На устройстве генерируется пара ECDH P-256 (WebCrypto); приватный JWK
 *   хранится в localStorage (per user), публичный — регистрируется на сервере.
 * - Для личного чата из моего приватного ключа и публичного ключа собеседника
 *   вычисляется общий секрет ECDH, из него через HKDF-SHA256 выводится
 *   AES-GCM-ключ конкретного чата (info = "chat:<chat_id>").
 * - Текст шифруется AES-GCM (случайный IV на каждое сообщение), на сервер
 *   уходит только шифротекст вида `e2ee1:<iv_b64>:<data_b64>` + флаг encrypted.
 *
 * Упрощения: один «текущий» ключ на пользователя; смена ключа собеседника
 * (новое устройство) делает старые сообщения нечитаемыми; forward secrecy
 * добавляется на следующем этапе (Double Ratchet).
 */

import { api } from './api'

const STORE_PREFIX = 'microshop_e2ee_v1_'
const PREFIX = 'e2ee1:'
const HKDF_INFO_PREFIX = 'chat:'

/** Показываем в интерфейсе, когда расшифровать не удалось (нет ключа и т.п.). */
export const ENCRYPTED_FALLBACK = '🔒 Сообщение'

const te = new TextEncoder()
const td = new TextDecoder()

const privCache = new Map<number, CryptoKey>()
const pubJwkCache = new Map<number, JsonWebKey>()
const peerKeyCache = new Map<number, string | null>() // user_id -> публичный JWK (JSON) или null
const chatKeyCache = new Map<number, CryptoKey>() // chat_id -> AES-GCM ключ
let bootstrappedUserId: number | null = null
let uploadOk = false

const storageKeyFor = (userId: number): string => `${STORE_PREFIX}${userId}`

const safeGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
const safeSet = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* переполнение/приватный режим — просто не сохраняем */
  }
}

export const isE2eeAvailable = (): boolean =>
  typeof window !== 'undefined' && !!window.crypto?.subtle && !!window.TextEncoder

/** «Выглядит» ли текст как E2EE-шифротекст. */
export const isEncryptedPayload = (text: string | null | undefined): boolean =>
  typeof text === 'string' && text.startsWith(PREFIX)

const bufToB64 = (input: ArrayBuffer | Uint8Array): string => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

const b64ToBuf = (b64: string): Uint8Array => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

const ecdhParams = { name: 'ECDH', namedCurve: 'P-256' } as const

async function importPrivateJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ecdhParams, true, ['deriveBits'])
}

/** Гарантирует наличие ключа устройства для userId (генерирует, если нет). */
export async function ensureDeviceKey(userId: number): Promise<void> {
  if (!isE2eeAvailable()) return
  if (privCache.has(userId)) return

  const stored = safeGet(storageKeyFor(userId))
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { priv: JsonWebKey; pub: JsonWebKey }
      if (parsed?.priv?.d && parsed?.pub?.x) {
        privCache.set(userId, await importPrivateJwk(parsed.priv))
        pubJwkCache.set(userId, parsed.pub)
        return
      }
    } catch {
      /* повреждённая запись — генерируем заново */
    }
  }

  const pair = await crypto.subtle.generateKey(ecdhParams, true, ['deriveBits'])
  const [privJwk, pubJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.privateKey),
    crypto.subtle.exportKey('jwk', pair.publicKey)
  ])
  safeSet(storageKeyFor(userId), JSON.stringify({ priv: privJwk, pub: pubJwk }))
  privCache.set(userId, pair.privateKey)
  pubJwkCache.set(userId, pubJwk as JsonWebKey)
}

/** Мой публичный ключ (JWK, JSON-строка) для загрузки на сервер. */
export async function myPublicJwkJson(userId: number): Promise<string> {
  await ensureDeviceKey(userId)
  const pub = pubJwkCache.get(userId)
  if (!pub) throw new Error('Нет ключа устройства')
  return JSON.stringify(pub)
}

/**
 * Bootstrap после логина: гарантируем ключ и регистрируем публичный на сервере.
 * Возвращает true, если ключ готов и опубликован (можно шифровать исходящие).
 */
export async function bootstrapE2ee(userId: number): Promise<boolean> {
  if (!isE2eeAvailable()) return false
  await ensureDeviceKey(userId)
  bootstrappedUserId = userId
  try {
    await api.put<{ ok: boolean }>('/keys/me/', {
      public_key: await myPublicJwkJson(userId)
    })
    uploadOk = true
  } catch {
    uploadOk = false
  }
  return uploadOk
}

/** Публичный JWK (JSON-строка) собеседника или null, если ключа нет. */
export async function peerPublicKey(userId: number): Promise<string | null> {
  if (peerKeyCache.has(userId)) return peerKeyCache.get(userId) ?? null
  let jwk: string | null = null
  try {
    const response = await api.get<{ has_key: boolean; public_key?: string | null }>(
      `/keys/${userId}/`
    )
    if (response.data?.has_key && response.data.public_key) {
      jwk = response.data.public_key
    }
  } catch {
    jwk = null
  }
  peerKeyCache.set(userId, jwk)
  return jwk
}

/** AES-GCM ключ чата (общий секрет двух сторон), с кэшем по chat_id. */
export async function chatAesKey(
  myUserId: number,
  peerUserId: number,
  chatId: number
): Promise<CryptoKey | null> {
  if (chatKeyCache.has(chatId)) return chatKeyCache.get(chatId) ?? null
  const peerJwkJson = await peerPublicKey(peerUserId)
  if (!peerJwkJson) return null
  await ensureDeviceKey(myUserId)
  const myPriv = privCache.get(myUserId)
  if (!myPriv) return null

  let peerPub: CryptoKey
  try {
    peerPub = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(peerJwkJson) as JsonWebKey,
      ecdhParams,
      false,
      []
    )
  } catch {
    return null
  }

  try {
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPub }, myPriv, 256)
    const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
    const salt = te.encode('microshop-e2ee-v1')
    const info = te.encode(HKDF_INFO_PREFIX + String(chatId))
    const aes = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
    chatKeyCache.set(chatId, aes)
    return aes
  } catch {
    return null
  }
}

/** Шифрует текст: `e2ee1:<iv_b64>:<ct_b64>` (GCM уже включает тег). */
export async function encryptText(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext))
  return `${PREFIX}${bufToB64(iv)}:${bufToB64(ct)}`
}

/** Расшифровывает payload; при ошибке/неверном ключе возвращает null. */
export async function decryptText(key: CryptoKey, payload: string): Promise<string | null> {
  try {
    if (!isEncryptedPayload(payload)) return payload
    const body = payload.slice(PREFIX.length)
    const sep = body.indexOf(':')
    if (sep <= 0) return null
    const iv = b64ToBuf(body.slice(0, sep))
    const data = b64ToBuf(body.slice(sep + 1))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return td.decode(plain)
  } catch {
    return null
  }
}

/** Сбрасывает кэши сессии (ключи на диске сохраняются — история читается снова). */
export function resetE2eeSession(): void {
  privCache.clear()
  pubJwkCache.clear()
  peerKeyCache.clear()
  chatKeyCache.clear()
  bootstrappedUserId = null
  uploadOk = false
}

export const e2eeSessionUserId = (): number | null => bootstrappedUserId
export const isMyKeyUploaded = (): boolean => uploadOk
