import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEVICE_ID_MAX_LENGTH,
  DEVICE_ID_STORAGE_KEY,
  LEGACY_DEVICE_ID,
  forgetOwnDeviceId,
  isValidDeviceId,
  newDeviceId,
  ownDeviceId
} from '@/utils/deviceId'

// Свой сервер не поднимаем: важно только то, ЧТО уходит в PUT /keys/me/.
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    api: {
      put: vi.fn(async () => ({ data: { ok: true } })),
      get: vi.fn(async () => ({ data: { has_key: false } }))
    }
  }
})

/**
 * Идентификатор устройства (A5): сервер хранит ключи E2EE по паре
 * `(user_id, device_id)`, поэтому клиент обязан представиться. Ошибка здесь
 * тихая и дорогая: два устройства с одним id снова затирали бы друг другу ключ,
 * а новое устройство не получило бы обёрток с ключом чата.
 */
describe('идентификатор устройства', () => {
  beforeEach(() => {
    window.localStorage.clear()
    forgetOwnDeviceId()
  })

  it('создаётся один раз и потом переиспользуется', () => {
    const first = ownDeviceId()
    forgetOwnDeviceId()
    const second = ownDeviceId()
    expect(first).toBe(second)
    expect(window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(first)
  })

  it('влезает в серверный лимит и не содержит пробелов', () => {
    const id = ownDeviceId()
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(DEVICE_ID_MAX_LENGTH)
    expect(id).toBe(id.trim())
    expect(id).not.toContain(' ')
  })

  it('у разных браузеров (чистое хранилище) значения разные', () => {
    const first = newDeviceId()
    const second = newDeviceId()
    expect(first).not.toBe(second)
    expect(isValidDeviceId(first)).toBe(true)
  })

  it('старое устройство остаётся legacy, а не превращается в новое', () => {
    // Ключ выдан прежним клиентом: иначе тот же ключ записался бы на сервер
    // второй строкой и у собеседника появилось бы лишнее устройство.
    const id = ownDeviceId({ hasStoredKey: true })
    expect(id).toBe(LEGACY_DEVICE_ID)
    expect(window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(LEGACY_DEVICE_ID)
  })

  it('сохранённая метка важнее legacy-догадки', () => {
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, 'device-abc')
    expect(ownDeviceId({ hasStoredKey: true })).toBe('device-abc')
  })

  it('мусор в хранилище заменяется новым идентификатором', () => {
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, '   ')
    const id = ownDeviceId()
    expect(id).not.toBe('   ')
    expect(isValidDeviceId(id)).toBe(true)
  })

  it('слишком длинная метка не принимается', () => {
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, 'x'.repeat(DEVICE_ID_MAX_LENGTH + 1))
    const id = ownDeviceId()
    expect(id).not.toBe('x'.repeat(DEVICE_ID_MAX_LENGTH + 1))
    expect(id.length).toBeLessThanOrEqual(DEVICE_ID_MAX_LENGTH)
  })

  it('при недоступном localStorage не падает и что-то возвращает', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('нет доступа')
    })
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('нет доступа')
    })
    forgetOwnDeviceId()
    expect(() => ownDeviceId()).not.toThrow()
    expect(isValidDeviceId(ownDeviceId())).toBe(true)
    spy.mockRestore()
    setSpy.mockRestore()
  })
})

describe('e2ee: устройство уходит на сервер вместе с ключом', () => {
  it('bootstrapE2ee прикладывает device_id этого устройства', async () => {
    const { api } = await import('@/services/api')
    const { bootstrapE2ee } = await import('@/services/e2ee')

    const ok = await bootstrapE2ee(42)

    expect(ok).toBe(true)
    const calls = vi.mocked(api.put).mock.calls as unknown as [string, Record<string, unknown>][]
    const keysCall = calls.find(([url]) => url === '/keys/me/')
    expect(keysCall, 'ключ должен уходить на сервер').toBeTruthy()
    const body = keysCall?.[1] ?? {}
    expect(typeof body.public_key).toBe('string')
    expect(body.device_id).toBe(ownDeviceId({ hasStoredKey: true }))
    expect(body.device_id).not.toBe('')
  })
})
