/**
 * Сквозное шифрование: ключи на устройство, без forward secrecy.
 *
 * - На устройстве генерируется пара ECDH P-256 (WebCrypto); приватный JWK
 *   хранится в localStorage (per user), публичный — регистрируется на сервере.
 * - Для личного чата из моего приватного ключа и публичного ключа собеседника
 *   вычисляется общий секрет ECDH, из него через HKDF-SHA256 выводится
 *   AES-GCM-ключ конкретного чата (info = "chat:<chat_id>").
 * - Для группового чата используется отдельный симметричный ключ группы
 *   (32 байта). Он раздаётся участникам «обёртками», зашифрованными парным
 *   ключом (`pair:<min>:<max>`); сервер обёрток не читает.
 * - Текст (и конверт вложения с его ключом) шифруется AES-GCM (случайный IV на
 *   каждое сообщение), на сервер уходит `e2ee1:<iv_b64>:<data_b64>` + флаг
 *   encrypted. Файлы шифруются отдельным ключом, который лежит в конверте.
 *
 * Упрощения: один «текущий» ключ на пользователя; смена ключа собеседника
 * (новое устройство) делает старые сообщения нечитаемыми; forward secrecy
 * добавляется на следующем этапе (Double Ratchet).
 */

import { api } from './api'

const STORE_PREFIX = 'pismo_e2ee_v1_'
const PREFIX = 'e2ee1:'
const HKDF_INFO_PREFIX = 'chat:'
const PAIR_INFO_PREFIX = 'pair:'

/** Показываем в интерфейсе, когда расшифровать не удалось (нет ключа и т.п.). */
export const ENCRYPTED_FALLBACK = '🔒 Сообщение'

const te = new TextEncoder()
const td = new TextDecoder()

const privCache = new Map<number, CryptoKey>()
const pubJwkCache = new Map<number, JsonWebKey>()
const peerKeyCache = new Map<number, string | null>() // user_id -> публичный JWK (JSON) или null
const chatKeyCache = new Map<number, CryptoKey>() // chat_id -> AES-GCM ключ
const pairKeyCache = new Map<string, CryptoKey>() // "min:max" -> AES-GCM ключ пары
const groupRawCache = new Map<number, Uint8Array>() // chat_id -> сырой ключ группы
const groupKeyCache = new Map<number, CryptoKey>() // chat_id -> AES-GCM ключ группы
let bootstrappedUserId: number | null = null
let uploadOk = false

/** Длина ключа группы (AES-256) в байтах. */
export const GROUP_KEY_BYTES = 32

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

/** Выводит AES-GCM ключ из ECDH(мой приватный, публичный собеседника) + HKDF. */
async function deriveAesKeyWithPeer(
  myUserId: number,
  peerUserId: number,
  info: string
): Promise<CryptoKey | null> {
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
    // ВНИМАНИЕ: соль — часть криптопротокола, а НЕ название приложения.
    // Её изменение сделало бы нечитаемыми все ранее зашифрованные сообщения.
    const salt = te.encode('microshop-e2ee-v1')
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  } catch {
    return null
  }
}

/** AES-GCM ключ чата (общий секрет двух сторон), с кэшем по chat_id. */
export async function chatAesKey(
  myUserId: number,
  peerUserId: number,
  chatId: number
): Promise<CryptoKey | null> {
  if (chatKeyCache.has(chatId)) return chatKeyCache.get(chatId) ?? null
  const aes = await deriveAesKeyWithPeer(myUserId, peerUserId, HKDF_INFO_PREFIX + String(chatId))
  if (!aes) return null
  chatKeyCache.set(chatId, aes)
  return aes
}

/**
 * AES-GCM ключ ПАРЫ пользователей (без привязки к чату): нужен, чтобы
 * заворачивать/разворачивать ключ группы. Info не зависит от порядка.
 */
export async function pairwiseAesKey(
  myUserId: number,
  peerUserId: number
): Promise<CryptoKey | null> {
  const cacheKey = `${Math.min(myUserId, peerUserId)}:${Math.max(myUserId, peerUserId)}`
  const cached = pairKeyCache.get(cacheKey)
  if (cached) return cached
  const aes = await deriveAesKeyWithPeer(myUserId, peerUserId, `${PAIR_INFO_PREFIX}${cacheKey}`)
  if (!aes) return null
  pairKeyCache.set(cacheKey, aes)
  return aes
}

/** Ключ чата: для группы — ключ группы, для личного — парный ключ чата. */
export async function chatAesKeyFor(
  myUserId: number,
  chat: { id: number; is_group?: boolean; users: { id: number }[] }
): Promise<CryptoKey | null> {
  if (chat.is_group) return groupChatAesKey(myUserId, chat.id)
  const peer = chat.users.find((user) => user.id !== myUserId)
  if (!peer) return null
  return chatAesKey(myUserId, peer.id, chat.id)
}

/** Готов ли чат к E2EE сейчас: есть ключ собеседника (личный) или группы. */
export async function e2eeReadyForChat(
  myUserId: number,
  chat: { id: number; is_group?: boolean; users: { id: number }[] }
): Promise<boolean> {
  if (chat.is_group) return !!(await groupChatAesKey(myUserId, chat.id))
  const peer = chat.users.find((user) => user.id !== myUserId)
  if (!peer) return false
  return !!(await peerPublicKey(peer.id))
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

// ---------------------------------------------------------------------------
// Байты и строки: шифрование вложений и ключей (всё в том же формате e2ee1:).
// ---------------------------------------------------------------------------

export const bytesToB64 = (bytes: Uint8Array): string => bufToB64(bytes)

export const bytesFromB64 = (b64: string): Uint8Array => b64ToBuf(b64)

/** Случайные байты (ключ группы, ключ файла). */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  crypto.getRandomValues(out)
  return out
}

/** Импортирует сырые байты как AES-GCM-ключ (encrypt+decrypt). */
export async function importRawAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export interface EncryptedBytes {
  /** IV (base64) — хранится рядом с шифротекстом. */
  iv: string
  data: ArrayBuffer
}

/** Шифрует произвольные байты (вложение) — AES-GCM, IV на каждый файл новый. */
export async function encryptBytes(key: CryptoKey, data: ArrayBuffer): Promise<EncryptedBytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return { iv: bufToB64(iv), data: ct }
}

/** Расшифровывает байты; null — ключ/данные не сошлись. */
export async function decryptBytes(
  key: CryptoKey,
  ivB64: string,
  data: ArrayBuffer
): Promise<ArrayBuffer | null> {
  try {
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(ivB64) }, key, data)
  } catch {
    return null
  }
}

/** Шифрует сырые байты (ключ группы) в payload `e2ee1:<iv>:<ct>`. */
export async function encryptRaw(key: CryptoKey, raw: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw)
  return `${PREFIX}${bufToB64(iv)}:${bufToB64(ct)}`
}

/** Расшифровывает payload `e2ee1:<iv>:<ct>` в сырые байты. */
export async function decryptRaw(key: CryptoKey, payload: string): Promise<Uint8Array | null> {
  try {
    if (!isEncryptedPayload(payload)) return null
    const body = payload.slice(PREFIX.length)
    const sep = body.indexOf(':')
    if (sep <= 0) return null
    const iv = b64ToBuf(body.slice(0, sep))
    const data = b64ToBuf(body.slice(sep + 1))
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Ключ группы (E2EE в групповых чатах)
// ---------------------------------------------------------------------------

interface GroupKeyResponse {
  chat_id: number
  has_key: boolean
  wrapped_key?: string | null
  wrapped_by?: number | null
}

export interface GroupKeyEntry {
  user_id: number
  wrapped_key: string
}

/**
 * Сырой ключ группы из МОЕЙ обёртки: `GET /keys/group/{chat_id}/`, затем
 * расшифровка парным ключом с тем, кто обёртку раздал (`wrapped_by`).
 * null — обёртки нет (меня ещё не включили в раздачу) или чужая обёртка.
 */
export async function groupRawKey(myUserId: number, chatId: number): Promise<Uint8Array | null> {
  const cached = groupRawCache.get(chatId)
  if (cached) return cached
  let row: GroupKeyResponse | null
  try {
    row = (await api.get<GroupKeyResponse>(`/keys/group/${chatId}/`)).data
  } catch {
    return null
  }
  if (!row?.has_key || !row.wrapped_key || !row.wrapped_by) return null
  const wrapperKey = await pairwiseAesKey(myUserId, row.wrapped_by)
  if (!wrapperKey) return null
  const raw = await decryptRaw(wrapperKey, row.wrapped_key)
  if (!raw || raw.length !== GROUP_KEY_BYTES) return null
  groupRawCache.set(chatId, raw)
  return raw
}

/** AES-GCM ключ группы (null — обёртки нет/не расшифровалась). */
export async function groupChatAesKey(myUserId: number, chatId: number): Promise<CryptoKey | null> {
  const cached = groupKeyCache.get(chatId)
  if (cached) return cached
  const raw = await groupRawKey(myUserId, chatId)
  if (!raw) return null
  const key = await importRawAesKey(raw)
  groupKeyCache.set(chatId, key)
  return key
}

/** Заворачивает ключ группы для участника (парный ECDH-ключ с ним). */
export async function wrapGroupKeyFor(
  myUserId: number,
  targetUserId: number,
  raw: Uint8Array
): Promise<string | null> {
  const key = await pairwiseAesKey(myUserId, targetUserId)
  if (!key) return null
  return encryptRaw(key, raw)
}

/** Загружает обёртки на сервер (`replace` — сначала стереть прежние). */
export async function putGroupKeys(
  chatId: number,
  entries: GroupKeyEntry[],
  replace: boolean
): Promise<void> {
  if (entries.length === 0) return
  await api.put(`/keys/group/${chatId}/`, { keys: entries, replace })
}

export interface DistributeResult {
  /** Ключ, который раздали (новый или уже известный). */
  raw: Uint8Array
  /** Участники без опубликованного ключа устройства — им раздать не удалось. */
  missing: number[]
}

/**
 * Раздаёт ключ группы всем участникам: у кого нет обёртки — создаёт новую,
 * при ротации передайте `rotate` (тогда всем уходит НОВЫЙ ключ).
 */
export async function distributeGroupKey(
  myUserId: number,
  chatId: number,
  memberIds: number[],
  options: { rotate?: boolean } = {}
): Promise<DistributeResult> {
  const existing = options.rotate ? null : await groupRawKey(myUserId, chatId)
  const raw = existing ?? randomBytes(GROUP_KEY_BYTES)
  const entries: GroupKeyEntry[] = []
  const missing: number[] = []
  for (const memberId of memberIds) {
    const wrapped = await wrapGroupKeyFor(myUserId, memberId, raw)
    if (wrapped) entries.push({ user_id: memberId, wrapped_key: wrapped })
    else missing.push(memberId)
  }
  await putGroupKeys(chatId, entries, true)
  groupRawCache.set(chatId, raw)
  groupKeyCache.set(chatId, await importRawAesKey(raw))
  return { raw, missing }
}

/** Сбрасывает кэш ключа группы (например, после ротации на другом устройстве). */
export function clearGroupKeyCache(chatId?: number): void {
  if (chatId === undefined) {
    groupRawCache.clear()
    groupKeyCache.clear()
    return
  }
  groupRawCache.delete(chatId)
  groupKeyCache.delete(chatId)
}

/** Сбрасывает кэши сессии (ключи на диске сохраняются — история читается снова). */
export function resetE2eeSession(): void {
  privCache.clear()
  pubJwkCache.clear()
  peerKeyCache.clear()
  chatKeyCache.clear()
  pairKeyCache.clear()
  groupRawCache.clear()
  groupKeyCache.clear()
  bootstrappedUserId = null
  uploadOk = false
}

export const e2eeSessionUserId = (): number | null => bootstrappedUserId
export const isMyKeyUploaded = (): boolean => uploadOk
