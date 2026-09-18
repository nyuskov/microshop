/**
 * Идентификатор ЭТОГО устройства (мультиустройство, A5).
 *
 * Зачем: раньше на аккаунт хранился один публичный ключ E2EE, поэтому вход с
 * телефона затирал ключ компьютера и вся прежняя переписка на нём становилась
 * нечитаемой. Сервер теперь держит ключи по паре `(user_id, device_id)`, и
 * идентификатор придумывает клиент — сервер про устройства ничего не знает и
 * знать не должен (это не средство идентификации человека, а просто метка
 * «одно и то же хранилище браузера»).
 *
 * Значение живёт в `localStorage`, то есть своё у каждого браузера/профиля —
 * именно это и означает «другое устройство». Никакой синхронизации между
 * устройствами нет: чтобы новое устройство читало НОВЫЕ сообщения, ключи чатов
 * должны раздаваться ему отдельными обёртками (см. `services/e2ee.ts`).
 */

/** Ключ в localStorage, под которым лежит идентификатор устройства. */
export const DEVICE_ID_STORAGE_KEY = 'pismo_device_id'

/** Метка устройств, которые заходили ещё старым клиентом (без идентификатора). */
export const LEGACY_DEVICE_ID = 'legacy'

/** Ограничение сервера: `device_id` — строка 1..64 символа. */
export const DEVICE_ID_MAX_LENGTH = 64

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
    /* приватный режим — идентификатор просто не сохранится до перезагрузки */
  }
}

/** Строка похожа на идентификатор устройства: непустая и влезает в лимит. */
export const isValidDeviceId = (value: string | null | undefined): boolean =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= DEVICE_ID_MAX_LENGTH &&
  value === value.trim()

/**
 * Новый идентификатор устройства.
 *
 * UUID из `crypto.randomUUID`, а если его нет (старый браузер/небезопасный
 * контекст) — 16 случайных байт в base64. Смысла в криптостойкости тут мало:
 * идентификатор только разделяет хранилища, но угадываемое значение позволило
 * бы чужому устройству записать свой ключ поверх нашего — поэтому случайное.
 */
export const newDeviceId = (): string => {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : undefined
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()
  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16))
    let bin = ''
    for (const byte of bytes) bin += String.fromCharCode(byte)
    return btoa(bin).replace(/[+/=]/g, '')
  }
  // Совсем без crypto (не должно случаться: без него нет и E2EE) — время.
  return `dev-${Date.now().toString(36)}`
}

export interface OwnDeviceIdOptions {
  /**
   * Есть ли в этом браузере уже сохранённый ключ E2EE (выданный старым
   * клиентом без идентификатора). Тогда устройство считается `legacy`: иначе
   * после обновления тот же ключ записался бы на сервер ВТОРОЙ строкой под
   * новым идентификатором, и у собеседника появилось бы «ещё одно устройство»,
   * которого нет.
   */
  hasStoredKey?: boolean
}

let cached: string | null = null

/**
 * Идентификатор этого устройства: сохранённый или только что созданный.
 * `null` — если localStorage недоступен и запомнить значение негде.
 */
export const ownDeviceId = (options: OwnDeviceIdOptions = {}): string => {
  if (cached) return cached

  const stored = safeGet(DEVICE_ID_STORAGE_KEY)
  if (isValidDeviceId(stored) && stored !== LEGACY_DEVICE_ID) {
    cached = stored as string
    return cached
  }

  if (stored === LEGACY_DEVICE_ID) {
    // `legacy` успели получить и НЕ старые устройства: метка ставилась уже после
    // генерации ключа, поэтому свежая установка тоже считалась «прежним
    // клиентом» (порядок исправлен в `services/e2ee.ts::bootstrapE2ee`).
    // Оставлять такую метку нельзя: два устройства делили бы одну строку ключа и
    // затирали бы друг друга — то есть ровно та проблема, ради которой делалось
    // A5. Переводим на свой идентификатор; у по-настоящему старого ключа
    // появится лишняя строка с ТЕМ ЖЕ публичным ключом — это безобидно.
    const migrated = newDeviceId()
    safeSet(DEVICE_ID_STORAGE_KEY, migrated)
    cached = migrated
    return cached
  }

  // Ключ есть, а метки нет — это старое устройство, не заводим ему новый id.
  const value = options.hasStoredKey ? LEGACY_DEVICE_ID : newDeviceId()
  safeSet(DEVICE_ID_STORAGE_KEY, value)
  cached = value
  return value
}

/**
 * Сбросить кэш идентификатора (при выходе из аккаунта).
 *
 * Само значение из localStorage НЕ удаляем: идентификатор описывает устройство,
 * а не вошедшего человека — после повторного входа это должно быть то же самое
 * устройство, иначе ключ чата пришлось бы раздавать ему заново.
 */
export const forgetOwnDeviceId = (): void => {
  cached = null
}
