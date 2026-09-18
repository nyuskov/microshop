/**
 * Мультиустройство у ключа ЛИЧНОГО чата (A5, этап 2).
 *
 * Раньше личный чат шифровался ключом из общего секрета двух «текущих» ключей
 * аккаунтов: второе устройство (телефон рядом с компьютером) новые сообщения
 * прочитать не могло. Теперь у личного чата есть симметричный ключ, а сервер
 * хранит обёртки — ключ, зашифрованный на общем секрете конкретной пары
 * устройств. Тест поднимает «настоящую» криптографию (WebCrypto из Node) и
 * подставной сервер ключей: каждое устройство — отдельный модуль e2ee со своими
 * кэшами, своей меткой устройства и своим ключом в localStorage.
 */
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const put = vi.fn()

vi.mock('../services/api', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args)
  }
}))

/**
 * В jsdom `crypto.subtle` нет — подставляем реализацию из Node.
 *
 * Без неё `isE2eeAvailable()` вернёт false, и весь модуль просто отключится.
 */
const installWebCrypto = (): void => {
  const nodeCrypto = webcrypto as unknown as Crypto
  const targets: Record<string, unknown>[] = [globalThis as Record<string, unknown>]
  const globalWindow = (globalThis as unknown as { window?: Record<string, unknown> }).window
  if (globalWindow && globalWindow !== globalThis) targets.push(globalWindow)
  for (const target of targets) {
    if (!(target.crypto as Crypto | undefined)?.subtle) {
      Object.defineProperty(target, 'crypto', { value: nodeCrypto, configurable: true })
    }
  }
}
installWebCrypto()

// Каждая «сессия устройства» — это повторный импорт графа модулей e2ee
// (`vi.resetModules`), а в общем прогоне файлы идут параллельно: по умолчанию
// пяти секунд на тест не хватает.
vi.setConfig({ testTimeout: 30_000 })

/** Кто «сейчас спрашивает» — токен в подставном сервере не разбираем. */
let currentUser = 1

interface ChatKeyRow {
  wrapped_key: string
  wrapped_by_user_id: number
  wrapped_by_device_id: string
}

/** Подставной сервер: ключи устройств (`user:device`) и обёртки ключа чата. */
const server = {
  devices: new Map<string, string>(),
  chatKeys: new Map<string, ChatKeyRow>()
}

const userKey = (userId: number, deviceId: string): string => `${userId}:${deviceId}`
const chatRowKey = (chatId: number, userId: number, deviceId: string): string =>
  `${chatId}:${userId}:${deviceId}`

/**
 * «Сессия устройства»: свежие модули, своя метка устройства и свой ключ E2EE.
 *
 * Именно так выглядит второй браузер: кэши пусты, а в localStorage — другой
 * `pismo_device_id` и другая пара ключей.
 */
async function openDevice(userId: number, deviceId: string) {
  currentUser = userId
  vi.resetModules()
  window.localStorage.clear()
  window.localStorage.setItem('pismo_device_id', deviceId)
  const e2ee = await import('../services/e2ee')
  await e2ee.ensureDeviceKey(userId)
  // Метку устройства читаем сразу: модуль кэширует её при первом обращении, а
  // тест переключает localStorage между «устройствами» — без этого раздача
  // подписалась бы чужой меткой.
  expect(e2ee.myDeviceId(userId)).toBe(deviceId)
  server.devices.set(userKey(userId, deviceId), await e2ee.myPublicJwkJson(userId))
  return e2ee
}

/** Ключ чата, которым шифровали (для сравнения обёрток на разных устройствах). */
const sameKey = (
  module: { bytesToB64: (bytes: Uint8Array) => string },
  a: Uint8Array,
  b: Uint8Array
) => module.bytesToB64(a) === module.bytesToB64(b)

describe('ключ личного чата на устройствах (A5)', () => {
  beforeEach(() => {
    get.mockReset()
    put.mockReset()
    server.devices.clear()
    server.chatKeys.clear()
    currentUser = 1
    window.localStorage.clear()

    get.mockImplementation(async (url: string, config?: { params?: { device_id?: string } }) => {
      const chatMatch = /^\/keys\/chat\/(\d+)\/$/.exec(url)
      if (chatMatch) {
        const chatId = Number(chatMatch[1])
        const deviceId = config?.params?.device_id ?? ''
        const row = server.chatKeys.get(chatRowKey(chatId, currentUser, deviceId))
        if (!row) return { data: { chat_id: chatId, device_id: deviceId, has_key: false } }
        return { data: { chat_id: chatId, device_id: deviceId, has_key: true, ...row } }
      }
      const userMatch = /^\/keys\/(\d+)\/$/.exec(url)
      if (userMatch) {
        const userId = Number(userMatch[1])
        const prefix = `${userId}:`
        const devices = [...server.devices.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, public_key]) => ({
            device_id: key.slice(prefix.length),
            public_key
          }))
        return {
          data: {
            user_id: userId,
            has_key: devices.length > 0,
            public_key: devices.at(-1)?.public_key ?? null,
            devices
          }
        }
      }
      throw new Error(`неожиданный GET ${url}`)
    })

    put.mockImplementation(
      async (url: string, body: { keys: unknown[]; sender_device_id: string }) => {
        const chatMatch = /^\/keys\/chat\/(\d+)\/$/.exec(url)
        if (!chatMatch) throw new Error(`неожиданный PUT ${url}`)
        const chatId = Number(chatMatch[1])
        let count = 0
        for (const raw of body.keys) {
          const entry = raw as { user_id: number; device_id: string; wrapped_key: string }
          if (!server.devices.has(userKey(entry.user_id, entry.device_id))) continue
          server.chatKeys.set(chatRowKey(chatId, entry.user_id, entry.device_id), {
            wrapped_key: entry.wrapped_key,
            wrapped_by_user_id: currentUser,
            wrapped_by_device_id: body.sender_device_id
          })
          count += 1
        }
        return { data: { count } }
      }
    )
  })

  it('устройство собеседника открывает обёртку и получает тот же ключ чата', async () => {
    const alice = await openDevice(1, 'dev-a')
    const bob = await openDevice(2, 'dev-b')

    currentUser = 1
    const aliceKey = await alice.distributeChatKey(1, 7, [1, 2], { create: true })
    expect(aliceKey.stored).toBe(2)
    expect(aliceKey.raw).not.toBeNull()

    currentUser = 2
    const bobRaw = await bob.chatRawKey(2, 7)
    expect(bobRaw).not.toBeNull()
    expect(sameKey(alice, bobRaw as Uint8Array, aliceKey.raw as Uint8Array)).toBe(true)
  })

  it('второе устройство того же аккаунта читает чат', async () => {
    const laptop = await openDevice(1, 'dev-a')
    const phone = await openDevice(1, 'dev-b')
    await openDevice(2, 'dev-bob')

    currentUser = 1
    const sent = await laptop.distributeChatKey(1, 7, [1, 2], { create: true })
    // Обёртки: ноутбук, телефон и устройство собеседника.
    expect(sent.stored).toBe(3)

    currentUser = 1
    const phoneRaw = await phone.chatRawKey(1, 7)
    expect(phoneRaw).not.toBeNull()
    expect(sameKey(laptop, phoneRaw as Uint8Array, sent.raw as Uint8Array)).toBe(true)
  })

  it('новое устройство собеседника получает ключ при обновлении обёрток', async () => {
    const alice = await openDevice(1, 'dev-a')
    const bobPhone = await openDevice(2, 'dev-phone')

    currentUser = 1
    await alice.distributeChatKey(1, 7, [1, 2], { create: true })

    // У Боба появился планшет: свой ключ он зарегистрировал, а обёртки для него нет.
    const bobTablet = await openDevice(2, 'dev-tablet')
    currentUser = 2
    expect(await bobTablet.chatRawKey(2, 7)).toBeNull()

    // Обёртки обновляет устройство, у которого ключ уже есть (телефон Боба).
    currentUser = 2
    await bobPhone.refreshChatKeyWrappers(2, 7, [1, 2])

    currentUser = 2
    const tabletRaw = await bobTablet.chatRawKey(2, 7)
    expect(tabletRaw).not.toBeNull()

    currentUser = 1
    const aliceRaw = await alice.chatRawKey(1, 7)
    expect(sameKey(alice, tabletRaw as Uint8Array, aliceRaw as Uint8Array)).toBe(true)
  })

  it('для расшифровки сначала идёт симметричный ключ, затем прежний', async () => {
    const alice = await openDevice(1, 'dev-a')
    await openDevice(2, 'dev-b')

    currentUser = 1
    await alice.distributeChatKey(1, 7, [1, 2], { create: true })

    const keys = await alice.chatDecryptKeysFor(1, { id: 7, users: [{ id: 1 }, { id: 2 }] })
    expect(keys).toHaveLength(2)

    // Симметричным (первым) читается то, что зашифровано ключом чата...
    const fresh = await alice.encryptText(keys[0] as CryptoKey, 'привет')
    expect(await alice.decryptTextWithKeys(keys, fresh)).toBe('привет')
    // ...а прежним — переписка, зашифрованная до появления обёрток.
    const legacy = await alice.encryptText(keys[1] as CryptoKey, 'старое')
    expect(await alice.decryptTextWithKeys(keys, legacy)).toBe('старое')
  })

  it('обёртка не открывается другим устройством того же аккаунта', async () => {
    const alice = await openDevice(1, 'dev-a')
    await openDevice(2, 'dev-b')
    await openDevice(2, 'dev-b2')

    const raw = alice.randomBytes(32)
    const keyForBob = await alice.pairwiseAesKeyWithDevice(1, 2, 'dev-b')
    const keyForOther = await alice.pairwiseAesKeyWithDevice(1, 2, 'dev-b2')
    expect(keyForBob).not.toBeNull()
    expect(keyForOther).not.toBeNull()

    const wrapped = await alice.encryptRaw(keyForBob as CryptoKey, raw)
    // Ключ парный именно с устройством-получателем: у другого устройства
    // собеседника тот же шифротекст не откроется.
    expect(await alice.decryptRaw(keyForOther as CryptoKey, wrapped)).toBeNull()
  })
})

describe('метка устройства при первой установке (A5)', () => {
  it('свежая установка получает свой идентификатор, а не legacy', async () => {
    // Грабля: метку надо зафиксировать ДО генерации ключа — иначе ключ уже
    // «есть», метки нет, и устройство считалось бы старым клиентом. Тогда
    // телефон и компьютер писали бы ключ в одну строку — то есть ровно то,
    // ради чего делалось A5.
    vi.resetModules()
    window.localStorage.clear()
    get.mockResolvedValue({ data: { has_key: false } })
    put.mockResolvedValue({ data: { ok: true, changed: false } })

    const e2ee = await import('../services/e2ee')
    await e2ee.bootstrapE2ee(1)

    const deviceId = e2ee.myDeviceId(1)
    expect(deviceId).not.toBe('legacy')
    expect(deviceId.length).toBeGreaterThan(8)
    expect(window.localStorage.getItem('pismo_device_id')).toBe(deviceId)
  })

  it('устройство со старым ключом и без метки остаётся legacy', async () => {
    await openDevice(1, 'dev-a')
    // Так выглядит вход прежним клиентом: ключ есть, метки устройства не было.
    window.localStorage.removeItem('pismo_device_id')
    vi.resetModules()
    const e2ee = await import('../services/e2ee')
    expect(e2ee.myDeviceId(1)).toBe('legacy')
  })

  it('уже сохранённая метка legacy миграции подлежит', async () => {
    // `legacy` получали и свежие установки (метка ставилась после генерации
    // ключа), а два устройства с одной меткой затирали ключ друг друга —
    // поэтому такую метку заменяем своим идентификатором.
    await openDevice(1, 'dev-a')
    window.localStorage.setItem('pismo_device_id', 'legacy')
    vi.resetModules()
    const e2ee = await import('../services/e2ee')
    const migrated = e2ee.myDeviceId(1)
    expect(migrated).not.toBe('legacy')
    expect(window.localStorage.getItem('pismo_device_id')).toBe(migrated)
  })
})

describe('проводка мультиустройства в интерфейсе', () => {
  const source = (path: string): string => readFileSync(path, 'utf8')

  it('включение E2EE в личном чате раздаёт ключ, а открытие чата обновляет обёртки', () => {
    // Грабля: серверная часть без клиентской ничего не даёт — ключ должен
    // уехать на устройства, иначе второе устройство увидит «замки».
    const messenger = source('src/views/Messenger.vue')
    expect(messenger).toContain('distributeChatKey')
    expect(messenger).toContain('refreshChatKeyWrappers')
    // Расшифровка перебирает ключи (симметричный и прежний), а не берёт один.
    expect(messenger).toContain('decryptTextWithKeys')
    expect(messenger).toContain('chatDecryptKeysFor')
  })
})
