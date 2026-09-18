/**
 * Резервная копия ключа шифрования (F2).
 *
 * Приватный ключ устройства живёт только в `localStorage`: переустановка
 * приложения или потеря телефона делают переписку зашифрованных чатов
 * нечитаемой. Копия — это ключ, зашифрованный парольной фразой (PBKDF2 +
 * AES-GCM), поэтому проверяем самый важный сценарий: на пустом устройстве
 * восстанавливается ТОТ ЖЕ ключ и им читается то, что было зашифровано раньше.
 *
 * Криптография настоящая (WebCrypto из Node — в jsdom `crypto.subtle` нет),
 * сеть подставная: нужен только список устройств собеседника.
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

/** В jsdom `crypto.subtle` нет — подставляем реализацию из Node. */
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

// Тест тяжёлый не по логике, а по криптографии: каждая копия и каждое
// восстановление — это PBKDF2 на 210 000 итераций, а файлы в общем прогоне идут
// параллельно. Пяти секунд по умолчанию не хватает, и тест падает «на ровном месте».
vi.setConfig({ testTimeout: 30_000 })

const PASSPHRASE = 'моя-фраза-2026'
const USER_ID = 1
const PEER_ID = 2
const CHAT_ID = 7

/** Публичные ключи чужих устройств: их отдаёт `GET /keys/{user_id}/`. */
const devices = new Map<string, string>()

/** Это устройство: свой localStorage, свой ключ, свои кэши. */
async function openOwnDevice(deviceId: string) {
  vi.resetModules()
  window.localStorage.clear()
  window.localStorage.setItem('pismo_device_id', deviceId)
  const e2ee = await import('../services/e2ee')
  const backup = await import('../services/e2eeBackup')
  await e2ee.ensureDeviceKey(USER_ID)
  // Метку закрепляем сразу: модуль кэширует её лениво.
  expect(e2ee.myDeviceId(USER_ID)).toBe(deviceId)
  return { e2ee, backup }
}

/** Собеседник: его ключ нужен, чтобы получить «прежний» ключ личного чата. */
async function openPeer(userId: number, deviceId: string) {
  vi.resetModules()
  const e2ee = await import('../services/e2ee')
  await e2ee.ensureDeviceKey(userId)
  devices.set(`${userId}:${deviceId}`, await e2ee.myPublicJwkJson(userId))
  return e2ee
}

/** Пустое «новое устройство» — как будто приложение поставили заново. */
async function openBlankDevice() {
  vi.resetModules()
  window.localStorage.clear()
  const e2ee = await import('../services/e2ee')
  const backup = await import('../services/e2eeBackup')
  return { e2ee, backup }
}

describe('резервная копия ключа шифрования (F2)', () => {
  beforeEach(() => {
    get.mockReset()
    put.mockReset()
    devices.clear()
    put.mockResolvedValue({ data: { ok: true } })
    get.mockImplementation(async (url: string) => {
      const match = /^\/keys\/(\d+)\/$/.exec(url)
      if (!match) throw new Error(`неожиданный GET ${url}`)
      const userId = Number(match[1])
      const prefix = `${userId}:`
      const list = [...devices.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, public_key]) => ({ device_id: key.slice(prefix.length), public_key }))
      return {
        data: {
          user_id: userId,
          has_key: list.length > 0,
          public_key: list.at(-1)?.public_key ?? null,
          devices: list
        }
      }
    })
  })

  it('на новом устройстве восстанавливается тот же ключ и метка устройства', async () => {
    const { e2ee, backup } = await openOwnDevice('dev-a')
    const before = await e2ee.myKeyMaterial(USER_ID)
    expect(before).not.toBeNull()
    const text = await backup.createBackup(USER_ID, PASSPHRASE)

    const blank = await openBlankDevice()
    const result = await blank.backup.restoreBackup(USER_ID, text, PASSPHRASE)

    const after = await blank.e2ee.myKeyMaterial(USER_ID)
    expect(result.deviceId).toBe(before?.device_id)
    expect(after?.device_id).toBe(before?.device_id)
    expect(after?.priv.d).toBe(before?.priv.d)
    expect(after?.pub.x).toBe(before?.pub.x)
    expect(after?.pub.y).toBe(before?.pub.y)
  })

  it('переписка, зашифрованная до восстановления, снова читается', async () => {
    await openPeer(PEER_ID, 'peer-dev')
    const { e2ee, backup } = await openOwnDevice('dev-a')
    const text = await backup.createBackup(USER_ID, PASSPHRASE)
    // «Прежний» ключ личного чата (общий секрет двух устройств) — именно им
    // зашифрована вся переписка до появления обёрток (A5).
    const oldKey = await e2ee.chatAesKey(USER_ID, PEER_ID, CHAT_ID)
    expect(oldKey).not.toBeNull()
    const payload = await e2ee.encryptText(oldKey as CryptoKey, 'секрет')

    const blank = await openBlankDevice()
    // До восстановления ключа чат прочитать нечем.
    const beforeKey = await blank.e2ee.chatAesKey(USER_ID, PEER_ID, CHAT_ID)
    expect(await blank.e2ee.decryptText(beforeKey as CryptoKey, payload)).toBeNull()

    await blank.backup.restoreBackup(USER_ID, text, PASSPHRASE)
    const restoredKey = await blank.e2ee.chatAesKey(USER_ID, PEER_ID, CHAT_ID)
    expect(await blank.e2ee.decryptText(restoredKey as CryptoKey, payload)).toBe('секрет')
  })

  it('чужая парольная фраза не подходит, а файл не портится', async () => {
    const { backup } = await openOwnDevice('dev-a')
    const text = await backup.createBackup(USER_ID, PASSPHRASE)

    const blank = await openBlankDevice()
    await expect(blank.backup.restoreBackup(USER_ID, text, 'другая-фраза-2026')).rejects.toThrow(
      'Не подошла парольная фраза'
    )
    // Ключ и метка из копии не установились — хранилище осталось пустым.
    expect(window.localStorage.getItem(`pismo_e2ee_v1_${USER_ID}`)).toBeNull()
    expect(window.localStorage.getItem('pismo_device_id')).toBeNull()
  })

  it('подменённый или испорченный файл отклоняется', async () => {
    const { backup } = await openOwnDevice('dev-a')
    const text = await backup.createBackup(USER_ID, PASSPHRASE)
    const file = JSON.parse(text) as { data: string }

    const blank = await openBlankDevice()
    await expect(blank.backup.restoreBackup(USER_ID, 'не json вовсе', PASSPHRASE)).rejects.toThrow(
      'не читается как JSON'
    )
    await expect(
      blank.backup.restoreBackup(USER_ID, JSON.stringify({ format: 'чужое' }), PASSPHRASE)
    ).rejects.toThrow('не файл резервной копии')

    // Правка шифротекста ломает проверку целостности AES-GCM.
    const tampered = JSON.stringify({ ...file, data: `${file.data.slice(0, -4)}AAAA` })
    await expect(blank.backup.restoreBackup(USER_ID, tampered, PASSPHRASE)).rejects.toThrow(
      'Не подошла парольная фраза'
    )
  })

  it('копию нельзя восстановить в другой аккаунт', async () => {
    const { backup } = await openOwnDevice('dev-a')
    const text = await backup.createBackup(USER_ID, PASSPHRASE)

    const blank = await openBlankDevice()
    await expect(blank.backup.restoreBackup(USER_ID + 1, text, PASSPHRASE)).rejects.toThrow(
      'для другого аккаунта'
    )
  })

  it('короткая фраза не принимается ни на сохранение, ни на восстановление', async () => {
    const { backup } = await openOwnDevice('dev-a')
    await expect(backup.createBackup(USER_ID, 'коротко')).rejects.toThrow('короче 8 символов')
    const text = await backup.createBackup(USER_ID, PASSPHRASE)
    await expect(backup.restoreBackup(USER_ID, text, 'коротко')).rejects.toThrow(
      'короче 8 символов'
    )
  })

  it('две копии одного ключа не совпадают побайтово', async () => {
    const { backup } = await openOwnDevice('dev-a')
    const first = await backup.createBackup(USER_ID, PASSPHRASE)
    const second = await backup.createBackup(USER_ID, PASSPHRASE)
    // Соль и IV случайны на каждую копию: одинаковый файл позволял бы сравнивать
    // копии между собой и выдавал бы, что ключ не менялся.
    expect(first).not.toBe(second)
  })

  it('ключ с несовпадающими частями не устанавливается', async () => {
    const own = await openOwnDevice('dev-a')
    const material = await own.e2ee.myKeyMaterial(USER_ID)
    const other = await openPeer(PEER_ID, 'peer-dev')
    const foreign = await other.myKeyMaterial(PEER_ID)
    // Приватная часть от одного ключа, публичная — от другого: шифрование
    // ломалось бы молча, поэтому установка обязана отказать.
    await expect(
      own.e2ee.installKeyMaterial(USER_ID, {
        device_id: 'dev-a',
        priv: material?.priv as JsonWebKey,
        pub: foreign?.pub as JsonWebKey
      })
    ).rejects.toThrow('части не совпадают')
  })
})

describe('проводка резервной копии в интерфейсе', () => {
  const source = (path: string): string => readFileSync(path, 'utf8')

  it('диалог копии подключается лениво, иначе чанк профиля растёт', () => {
    const profile = source('src/views/UserProfile.vue')
    expect(profile).toContain('E2eeBackupDialog')
    // Статический импорт раздул бы `UserProfile.js` (бюджет бандла) — только
    // через `defineAsyncComponent`.
    expect(profile).toContain("import('@/components/messenger/E2eeBackupDialog.vue')")
    expect(profile).not.toContain("from '@/components/messenger/E2eeBackupDialog.vue'")
    // И вход в него — из раздела «Безопасность».
    expect(profile).toContain('Резервная копия')
  })
})
