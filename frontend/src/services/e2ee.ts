/**
 * Сквозное шифрование: ключи на устройство, без forward secrecy.
 *
 * - На устройстве генерируется пара ECDH P-256 (WebCrypto); приватный JWK
 *   хранится в localStorage (per user), публичный — регистрируется на сервере
 *   вместе с идентификатором устройства (`utils/deviceId.ts`): у аккаунта
 *   может быть несколько устройств, каждое со своим ключом (A5).
 * - Для личного чата используется СИММЕТРИЧНЫЙ ключ чата, который раздаётся
 *   «обёртками» на каждое устройство обоих участников (`chat_device_keys`):
 *   поэтому переписку читают и телефон, и компьютер. Если обёртки ещё нет
 *   (чат зашифрован старым клиентом), работает прежний ключ из общего секрета
 *   двух «текущих» устройств — так читается старая история.
 * - Для группового чата — тот же симметричный ключ группы (32 байта). Он
 *   раздаётся участникам «обёртками», зашифрованными парным ключом
 *   (`pair:<min>:<max>`); сервер обёрток не читает.
 * - Текст (и конверт вложения с его ключом) шифруется AES-GCM (случайный IV на
 *   каждое сообщение), на сервер уходит `e2ee1:<iv_b64>:<data_b64>` + флаг
 *   encrypted. Файлы шифруются отдельным ключом, который лежит в конверте.
 *
 * Остаётся упрощение: нет forward secrecy (Double Ratchet) — ключ чата живёт,
 * пока его не перераспределят.
 */

import { api } from './api'
import { canonicalKey, orderKeys, safetyCodeFromBytes, type SafetyCode } from '@/utils/safetyNumber'

import {
  ownDeviceId,
  DEVICE_ID_STORAGE_KEY,
  forgetOwnDeviceId,
  isValidDeviceId
} from '@/utils/deviceId'

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
const devicesCache = new Map<number, DevicePublicKey[]>() // user_id -> устройства с ключами
const pairDeviceKeyCache = new Map<string, CryptoKey>() // "min:max:device" -> ключ с конкретным устройством
const chatRawCache = new Map<number, Uint8Array>() // chat_id -> сырой ключ ЛИЧНОГО чата
const chatSymKeyCache = new Map<number, CryptoKey>() // chat_id -> AES-GCM ключ личного чата
const refreshedChats = new Set<number>() // где обёртки уже обновляли в этой сессии
let bootstrappedUserId: number | null = null
let uploadOk = false

/** Устройство аккаунта с его публичным ключом (`GET /keys/{user_id}/`). */
export interface DevicePublicKey {
  device_id: string
  public_key: string
  changed_at?: string | null
}

/** Длина ключа группы (AES-256) в байтах. */
export const GROUP_KEY_BYTES = 32

const storageKeyFor = (userId: number): string => `${STORE_PREFIX}${userId}`

/**
 * Ключи собеседника, которые мы уже видели (`pismo_e2ee_v1_peer_v2_<id>` —
 * JSON-массив) и которые человек подтвердил кнопкой «Понятно»
 * (`…peer_ok_v2_<id>`).
 *
 * Смысл — TOFU («доверяем первому ключу»): если у собеседника ПОЯВИЛСЯ
 * незнакомый публичный ключ, то либо он зашёл с нового устройства/почистил
 * браузер (всё нормально), либо его аккаунт угнали и подсунули свой ключ, чтобы
 * читать переписку (MITM). Отличить одно от другого может только человек,
 * поэтому обязанность приложения — показать предупреждение, а не молча шифровать.
 *
 * Почему НАБОР, а не одно значение: ключей у аккаунта может быть несколько
 * (одно на устройство, см. A5), а `public_key` на сервере — это ключ САМОГО
 * СВЕЖЕГО устройства. То есть у собеседника с телефоном и компьютером это поле
 * законно перескакивает между устройствами. С одним запомненным ключом каждое
 * перескакивание выглядело как «сменил ключ», и предупреждение возвращалось
 * даже после «Понятно» (жалоба 19.09.2026). Теперь предупреждаем только про
 * НЕЗНАКОМЫЙ ключ, а подтверждение помнит все подтверждённые.
 */
const peerSeenKeyFor = (userId: number): string => `${STORE_PREFIX}peer_v2_${userId}`

/** Ключи собеседника, которые человек подтвердил кнопкой «Понятно». */
const peerAcceptedKeyFor = (userId: number): string => `${STORE_PREFIX}peer_ok_v2_${userId}`

/** Сколько ключей собеседника помним (устройства копятся годами). */
const MAX_PEER_KEYS = 8

export interface PeerKeyChange {
  /** Собеседник, у которого сменился ключ. */
  userId: number
  /** Прежний ключ (JWK, JSON) или null, если раньше нам его не показывали. */
  previous: string | null
  /** Новый ключ (JWK, JSON). */
  current: string
}

type PeerKeyListener = (change: PeerKeyChange) => void

const peerKeyListeners = new Set<PeerKeyListener>()

/** Подписка на смену ключа собеседника (для предупреждения в интерфейсе). */
export function onPeerKeyChanged(listener: PeerKeyListener): () => void {
  peerKeyListeners.add(listener)
  return () => {
    peerKeyListeners.delete(listener)
  }
}

/** Человек подтвердил новый ключ собеседника: больше не предупреждаем. */
export function acceptPeerKey(userId: number, jwk: string): void {
  rememberPeerKey(peerAcceptedKeyFor(userId), jwk)
}

/**
 * Список ключей собеседника из localStorage.
 *
 * Читает и СТАРЫЙ формат (одна JSON-строка с ключом — так было до
 * многоустройности): иначе после обновления приложения человек получил бы
 * предупреждение ещё раз на уже виденный ключ.
 */
function readPeerKeys(storageKey: string): string[] {
  const raw = safeGet(storageKey)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    /* не JSON — значит формат ещё старее; считаем значение самим ключом */
  }
  return [raw]
}

/** Дописывает ключ в список (без повторов, с ограничением длины). */
function rememberPeerKey(storageKey: string, jwk: string): void {
  const keys = readPeerKeys(storageKey)
  if (keys.includes(jwk)) return
  keys.push(jwk)
  safeSet(storageKey, JSON.stringify(keys.slice(-MAX_PEER_KEYS)))
}

/**
 * Замечает появление НЕЗНАКОМОГО ключа собеседника и сообщает об этом интерфейсу.
 *
 * Возвращает true, если человека нужно предупредить: ключ нам раньше не
 * встречался и человек его не подтверждал.
 */
function trackPeerKey(userId: number, jwk: string): boolean {
  const seenKey = peerSeenKeyFor(userId)
  const seen = readPeerKeys(seenKey)
  // Знакомый ключ — молчим. Сюда попадает и второе устройство собеседника, и
  // возврат к прежнему устройству: для человека это не событие.
  if (seen.includes(jwk)) return false

  const isFirstEver = seen.length === 0
  rememberPeerKey(seenKey, jwk)
  // Первый ключ собеседника — это и есть TOFU: сравнивать не с чем.
  if (isFirstEver) return false
  if (readPeerKeys(peerAcceptedKeyFor(userId)).includes(jwk)) return false

  const change: PeerKeyChange = {
    userId,
    previous: seen[seen.length - 1] ?? null,
    current: jwk
  }
  for (const listener of peerKeyListeners) {
    try {
      listener(change)
    } catch {
      /* предупреждение не должно ломать шифрование */
    }
  }
  return true
}

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
 *
 * Публичный ключ уходит вместе с идентификатором ЭТОГО устройства: сервер
 * хранит ключи по паре `(user_id, device_id)` (`backend/api_v1/keys/views.py`),
 * поэтому вход с телефона больше не затирает ключ компьютера (A5).
 */
export async function bootstrapE2ee(userId: number): Promise<boolean> {
  if (!isE2eeAvailable()) return false
  // Метку устройства фиксируем ДО генерации ключа. Иначе свежая установка
  // выглядела бы «старым клиентом» (ключ уже есть, метки нет) и получила бы
  // `device_id = legacy` — тогда телефон и компьютер писали бы ключ в одну
  // строку, то есть ровно та проблема, ради которой делалось A5.
  const deviceId = myDeviceId(userId)
  await ensureDeviceKey(userId)
  bootstrappedUserId = userId
  try {
    await api.put<{ ok: boolean }>('/keys/me/', {
      public_key: await myPublicJwkJson(userId),
      device_id: deviceId
    })
    uploadOk = true
  } catch {
    uploadOk = false
  }
  return uploadOk
}

/**
 * Идентификатор этого устройства для сервера.
 *
 * Если ключ E2EE в этом браузере уже есть, а метки устройства ещё нет — значит
 * устройство заходило старым клиентом: остаёмся `legacy`, чтобы тот же ключ не
 * превратился на сервере в «ещё одно устройство».
 */
export function myDeviceId(userId: number): string {
  return ownDeviceId({ hasStoredKey: !!safeGet(storageKeyFor(userId)) })
}

/**
 * Материал ключа ЭТОГО устройства — для резервной копии.
 *
 * Приватный ключ — это и есть доступ к переписке, поэтому он уходит только в
 * зашифрованном виде (см. `services/e2eeBackup.ts`), никогда открытым текстом.
 */
export interface DeviceKeyMaterial {
  /** Метка устройства: обёртки ключей чатов сделаны на пару (устройство, ключ). */
  device_id: string
  priv: JsonWebKey
  pub: JsonWebKey
}

/** Ключ устройства как есть (приватный, публичный, метка) или null. */
export async function myKeyMaterial(userId: number): Promise<DeviceKeyMaterial | null> {
  if (!isE2eeAvailable()) return null
  await ensureDeviceKey(userId)
  const pub = pubJwkCache.get(userId)
  const stored = safeGet(storageKeyFor(userId))
  if (!pub || !stored) return null
  try {
    const parsed = JSON.parse(stored) as { priv?: JsonWebKey }
    if (!parsed?.priv?.d) return null
    return { device_id: myDeviceId(userId), priv: parsed.priv, pub }
  } catch {
    return null
  }
}

/**
 * Устанавливает ключ устройства из резервной копии (новое устройство).
 *
 * Метку устройства восстанавливаем вместе с ключом: обёртки ключей чатов сделаны
 * на конкретное устройство, поэтому без метки восстановленный ключ историю не
 * откроет. Нового устройства на сервере при этом не появляется — строка та же,
 * просто с тем же ключом.
 *
 * Пару проверяем на согласованность: если публичная часть не та, что в приватном
 * ключе, шифрование ломалось бы молча (сообщения уходили бы «в никуда»).
 */
export async function installKeyMaterial(
  userId: number,
  material: DeviceKeyMaterial
): Promise<void> {
  if (!isE2eeAvailable()) throw new Error('Шифрование в этом браузере недоступно')
  const priv = await importPrivateJwk(material.priv)
  const exported = (await crypto.subtle.exportKey('jwk', priv)) as JsonWebKey
  if (!material.pub || exported.x !== material.pub.x || exported.y !== material.pub.y) {
    throw new Error('Ключ в резервной копии повреждён: части не совпадают')
  }
  safeSet(storageKeyFor(userId), JSON.stringify({ priv: material.priv, pub: material.pub }))
  if (isValidDeviceId(material.device_id)) {
    safeSet(DEVICE_ID_STORAGE_KEY, material.device_id)
  }
  // Ключ другой — все выведенные ключи и метка устройства в кэше устарели.
  forgetOwnDeviceId()
  resetE2eeSession()
  await ensureDeviceKey(userId)
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
  if (jwk) trackPeerKey(userId, jwk)
  peerKeyCache.set(userId, jwk)
  return jwk
}

/**
 * Код проверки ключей (safety number) для личного чата.
 *
 * Считается от публичных ключей ОБОИХ участников в фиксированном порядке, так
 * что у обоих получается один и тот же код: сравнили вслух — убедились, что
 * сервер не подменил ключ (см. `utils/safetyNumber.ts`).
 *
 * Возвращает null, если ключа собеседника ещё нет: проверять нечего, пока он не
 * зашёл в приложение.
 */
export async function safetyNumberWithPeer(
  myUserId: number,
  peerUserId: number
): Promise<SafetyCode | null> {
  if (!isE2eeAvailable()) return null
  const peerJson = await peerPublicKey(peerUserId)
  const myJson = await myPublicJwkJson(myUserId).catch(() => null)
  const mine = canonicalKey(myJson)
  const theirs = canonicalKey(peerJson)
  if (!mine || !theirs) return null
  const [first, second] = orderKeys(mine, theirs)
  const bytes = te.encode(`${first}|${second}`)
  const hash = await crypto.subtle.digest('SHA-512', bytes)
  return safetyCodeFromBytes(new Uint8Array(hash))
}

/** Выводит AES-GCM ключ из ECDH(мой приватный, публичный собеседника) + HKDF. */
async function deriveAesKeyWithPeer(
  myUserId: number,
  peerUserId: number,
  info: string
): Promise<CryptoKey | null> {
  const peerJwkJson = await peerPublicKey(peerUserId)
  if (!peerJwkJson) return null
  return deriveAesKeyWithJwk(myUserId, peerJwkJson, info)
}

/**
 * То же, но публичный ключ собеседника задан явно (JWK, JSON-строка).
 *
 * Нужно обёрткам на КОНКРЕТНОЕ устройство: у аккаунта их несколько, и каждому
 * соответствует свой публичный ключ.
 */
async function deriveAesKeyWithJwk(
  myUserId: number,
  peerJwkJson: string,
  info: string
): Promise<CryptoKey | null> {
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

/** AES-GCM ключ чата (общий секрет двух сторон), с кэшем по chat_id. */ export async function chatAesKey(
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

/**
 * Ключ чата для ШИФРОВАНИЯ.
 *
 * Группа — её собственный ключ. Личный чат — симметричный ключ из обёрток (A5:
 * его читают все устройства обоих участников), а если обёртки ещё нет — прежний
 * ключ из общего секрета двух «текущих» устройств: так продолжают работать чаты,
 * зашифрованные до появления обёрток.
 */
export async function chatAesKeyFor(
  myUserId: number,
  chat: { id: number; is_group?: boolean; users: { id: number }[] }
): Promise<CryptoKey | null> {
  if (chat.is_group) return groupChatAesKey(myUserId, chat.id)
  const symmetric = await personalChatKey(myUserId, chat.id)
  if (symmetric) return symmetric
  const peer = chat.users.find((user) => user.id !== myUserId)
  if (!peer) return null
  return chatAesKey(myUserId, peer.id, chat.id)
}

/**
 * Ключи, которыми МОЖЕТ быть зашифрован чат, в порядке проверки.
 *
 * Симметричный (многодевайсный) идёт первым, следом — прежний ключ из общего
 * секрета: сообщение могло уйти с устройства, которое обёртки ещё не получило.
 * Расшифровка перебирает их по очереди — иначе такие сообщения выглядели бы
 * «замками».
 */
export async function chatDecryptKeysFor(
  myUserId: number,
  chat: { id: number; is_group?: boolean; users: { id: number }[] }
): Promise<CryptoKey[]> {
  const keys: CryptoKey[] = []
  if (chat.is_group) {
    const group = await groupChatAesKey(myUserId, chat.id)
    if (group) keys.push(group)
    return keys
  }
  const symmetric = await personalChatKey(myUserId, chat.id)
  if (symmetric) keys.push(symmetric)
  const peer = chat.users.find((user) => user.id !== myUserId)
  if (peer) {
    const legacy = await chatAesKey(myUserId, peer.id, chat.id)
    if (legacy) keys.push(legacy)
  }
  return keys
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

// ---------------------------------------------------------------------------
// Ключ ЛИЧНОГО чата на устройства (A5, этап 2)
//
// Раньше личный чат шифровался ключом из общего секрета двух «текущих» ключей
// аккаунтов — второе устройство прочитать новые сообщения не могло. Теперь у
// личного чата есть СИММЕТРИЧНЫЙ ключ (как у группы), а сервер хранит обёртки:
// ключ, зашифрованный на общем секрете конкретной пары устройств
// (`backend/core/models/chat_device_key.py`, `PUT /keys/chat/{chat_id}/`).
// ---------------------------------------------------------------------------

/** Все устройства пользователя с их публичными ключами (кэш на сессию). */
export async function userDevices(userId: number): Promise<DevicePublicKey[]> {
  const cached = devicesCache.get(userId)
  if (cached) return cached
  let devices: DevicePublicKey[] = []
  try {
    const response = await api.get<{
      has_key: boolean
      public_key?: string | null
      devices?: DevicePublicKey[]
    }>(`/keys/${userId}/`)
    if (Array.isArray(response.data?.devices)) {
      devices = response.data.devices.filter((item) => item?.device_id && item?.public_key)
    } else if (response.data?.has_key && response.data.public_key) {
      // Старый сервер отдаёт один ключ без списка устройств — считаем его одним.
      devices = [{ device_id: 'legacy', public_key: response.data.public_key }]
    }
  } catch {
    devices = []
  }
  devicesCache.set(userId, devices)
  return devices
}

/**
 * Парный ключ с КОНКРЕТНЫМ устройством собеседника.
 *
 * Именно им шифруется обёртка ключа чата: получатель повторит ECDH своим
 * приватным ключом и публичным ключом раздатчика, поэтому обёртку откроет только
 * та пара устройств, для которой она сделана.
 */
export async function pairwiseAesKeyWithDevice(
  myUserId: number,
  peerUserId: number,
  peerDeviceId: string
): Promise<CryptoKey | null> {
  const cacheKey = `${Math.min(myUserId, peerUserId)}:${Math.max(myUserId, peerUserId)}:${peerDeviceId}`
  const cached = pairDeviceKeyCache.get(cacheKey)
  if (cached) return cached
  const devices = await userDevices(peerUserId)
  const jwk = devices.find((device) => device.device_id === peerDeviceId)?.public_key
  if (!jwk) return null
  const info = `${PAIR_INFO_PREFIX}${Math.min(myUserId, peerUserId)}:${Math.max(myUserId, peerUserId)}`
  const key = await deriveAesKeyWithJwk(myUserId, jwk, info)
  if (key) pairDeviceKeyCache.set(cacheKey, key)
  return key
}

interface ChatDeviceKeyResponse {
  chat_id: number
  device_id: string
  has_key: boolean
  wrapped_key?: string | null
  wrapped_by_user_id?: number | null
  wrapped_by_device_id?: string | null
}

interface ChatKeyEntry {
  user_id: number
  device_id: string
  wrapped_key: string
}

/**
 * Сырой симметричный ключ личного чата из МОЕЙ обёртки.
 *
 * null — обёртки для этого устройства нет (меня ещё не включили в раздачу) или
 * открыть её нечем: тогда чат шифруется прежним ключом из общего секрета.
 */
export async function chatRawKey(myUserId: number, chatId: number): Promise<Uint8Array | null> {
  const cached = chatRawCache.get(chatId)
  if (cached) return cached
  let row: ChatDeviceKeyResponse | null
  try {
    row = (
      await api.get<ChatDeviceKeyResponse>(`/keys/chat/${chatId}/`, {
        params: { device_id: myDeviceId(myUserId) }
      })
    ).data
  } catch {
    return null
  }
  if (!row?.has_key || !row.wrapped_key) return null
  if (!row.wrapped_by_user_id || !row.wrapped_by_device_id) return null
  const wrapperKey = await pairwiseAesKeyWithDevice(
    myUserId,
    row.wrapped_by_user_id,
    row.wrapped_by_device_id
  )
  if (!wrapperKey) return null
  const raw = await decryptRaw(wrapperKey, row.wrapped_key)
  if (!raw || raw.length !== GROUP_KEY_BYTES) return null
  chatRawCache.set(chatId, raw)
  return raw
}

/** AES-GCM ключ ЛИЧНОГО чата из обёрток (null — обёртки нет/не открылась). */
async function personalChatKey(myUserId: number, chatId: number): Promise<CryptoKey | null> {
  const cached = chatSymKeyCache.get(chatId)
  if (cached) return cached
  const raw = await chatRawKey(myUserId, chatId)
  if (!raw) return null
  const key = await importRawAesKey(raw)
  chatSymKeyCache.set(chatId, key)
  return key
}

/** Заворачивает ключ чата на все устройства участников и отправляет на сервер. */
async function putChatKeyEntries(
  myUserId: number,
  chatId: number,
  memberIds: number[],
  raw: Uint8Array
): Promise<{ stored: number; missing: number[] }> {
  const entries: ChatKeyEntry[] = []
  const missing: number[] = []
  for (const memberId of memberIds) {
    const devices = await userDevices(memberId)
    if (devices.length === 0) {
      missing.push(memberId)
      continue
    }
    for (const device of devices) {
      const key = await pairwiseAesKeyWithDevice(myUserId, memberId, device.device_id)
      if (!key) {
        missing.push(memberId)
        continue
      }
      entries.push({
        user_id: memberId,
        device_id: device.device_id,
        wrapped_key: await encryptRaw(key, raw)
      })
    }
  }
  if (entries.length === 0) return { stored: 0, missing }
  try {
    const response = await api.put<{ count: number }>(`/keys/chat/${chatId}/`, {
      keys: entries,
      // Никогда не удаляем чужие обёртки: у собеседника может быть тот же ключ,
      // а без его строк переписка разъехалась бы (ключи у сторон разные).
      replace: false,
      sender_device_id: myDeviceId(myUserId)
    })
    return { stored: response.data?.count ?? 0, missing }
  } catch {
    // Сервер откажет, если ни одно устройство получателя не зарегистрировано:
    // тогда просто остаёмся на прежнем ключе из общего секрета.
    return { stored: 0, missing }
  }
}

export interface ChatKeyDistributeResult {
  /** Ключ, который раздали (или уже известный); null — раздавать нечего. */
  raw: Uint8Array | null
  /** Сколько обёрток сохранил сервер. */
  stored: number
  /** Участники без зарегистрированных устройств — им ключ не ушёл. */
  missing: number[]
}

/**
 * Раздаёт ключ ЛИЧНОГО чата на устройства всех участников.
 *
 * `create` — выпустить ключ, если у меня его ещё нет (это делает тот, кто
 * включает шифрование в чате). Обёртки для новых устройств добавляются, уже
 * существующие не удаляются — см. `putChatKeyEntries`.
 */
export async function distributeChatKey(
  myUserId: number,
  chatId: number,
  memberIds: number[],
  options: { create?: boolean } = {}
): Promise<ChatKeyDistributeResult> {
  // Список устройств берём свежий: с прошлого раза у участника мог появиться
  // новый телефон, и обёртка нужна и для него.
  for (const memberId of memberIds) devicesCache.delete(memberId)
  const existing = await chatRawKey(myUserId, chatId)
  const raw = existing ?? (options.create ? randomBytes(GROUP_KEY_BYTES) : null)
  if (!raw) return { raw: null, stored: 0, missing: [] }
  const { stored, missing } = await putChatKeyEntries(myUserId, chatId, memberIds, raw)
  chatRawCache.set(chatId, raw)
  chatSymKeyCache.set(chatId, await importRawAesKey(raw))
  // Обёртки только что разошлись — повторный PUT при первом открытии чата не нужен.
  refreshedChats.add(chatId)
  return { raw, stored, missing }
}

/**
 * Обновляет обёртки, чтобы новое устройство участника получило ключ чата.
 *
 * Устройство, у которого ключа ещё нет, раздать его не может — это делает тот, у
 * кого ключ есть (как в группах). Хватает одного раза за сессию на чат: обёртки
 * существующих устройств от этого не меняются, а появившееся устройство
 * подхватится при следующем открытии чата.
 */
export async function refreshChatKeyWrappers(
  myUserId: number,
  chatId: number,
  memberIds: number[]
): Promise<void> {
  if (refreshedChats.has(chatId)) return
  refreshedChats.add(chatId)
  for (const memberId of memberIds) devicesCache.delete(memberId)
  const raw = await chatRawKey(myUserId, chatId)
  if (!raw) return
  await putChatKeyEntries(myUserId, chatId, memberIds, raw)
}

/**
 * Сбрасывает кэш ключа ЛИЧНОГО чата.
 *
 * Нужен, когда расшифровать не удалось: ключ могли перераспределить с другого
 * устройства (например, шифрование выключили и включили заново) — тогда обёртку
 * и список устройств надо перечитать.
 */
export function clearChatKeyCache(chatId?: number): void {
  if (chatId === undefined) {
    chatRawCache.clear()
    chatSymKeyCache.clear()
    devicesCache.clear()
    pairDeviceKeyCache.clear()
    refreshedChats.clear()
    return
  }
  chatRawCache.delete(chatId)
  chatSymKeyCache.delete(chatId)
  refreshedChats.delete(chatId)
}

/** Пробует расшифровать payload по очереди всеми ключами чата. */
export async function decryptTextWithKeys(
  keys: CryptoKey[],
  payload: string
): Promise<string | null> {
  for (const key of keys) {
    const plain = await decryptText(key, payload)
    if (plain !== null) return plain
  }
  return null
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
  devicesCache.clear()
  pairDeviceKeyCache.clear()
  chatRawCache.clear()
  chatSymKeyCache.clear()
  refreshedChats.clear()
  bootstrappedUserId = null
  uploadOk = false
}

export const e2eeSessionUserId = (): number | null => bootstrappedUserId
export const isMyKeyUploaded = (): boolean => uploadOk
