/**
 * Смена ключа собеседника (TOFU) — предупреждение о возможном перехвате.
 *
 * Ключ E2EE привязан к устройству и меняется при входе с нового телефона — это
 * нормально. Ровно так же выглядит подмена ключа тем, кто получил доступ к
 * аккаунту собеседника и хочет читать переписку (MITM). Клиент это различает
 * только одним способом: помнит, какой ключ видел раньше, и спрашивает
 * человека. Проверяем, что предупреждение приходит один раз на новый ключ, а
 * после подтверждения («Понятно, это его устройство») — не повторяется.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()

vi.mock('../services/api', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    put: vi.fn()
  }
}))

const loadModule = async () => {
  vi.resetModules()
  return await import('../services/e2ee')
}

const keyResponse = (jwk: string | null) => ({
  data: { user_id: 2, has_key: jwk !== null, public_key: jwk }
})

describe('peerPublicKey — отслеживание смены ключа', () => {
  beforeEach(() => {
    get.mockReset()
    window.localStorage.clear()
  })

  it('первый ключ собеседника — не повод предупреждать', async () => {
    const e2ee = await loadModule()
    const changes: unknown[] = []
    const off = e2ee.onPeerKeyChanged((change) => changes.push(change))
    get.mockResolvedValue(keyResponse('{"x":"first"}'))

    expect(await e2ee.peerPublicKey(2)).toBe('{"x":"first"}')
    expect(changes).toEqual([])
    off()
  })

  it('тот же ключ второй раз предупреждения не вызывает', async () => {
    const e2ee = await loadModule()
    const changes: unknown[] = []
    e2ee.onPeerKeyChanged((change) => changes.push(change))
    get.mockResolvedValue(keyResponse('{"x":"same"}'))

    await e2ee.peerPublicKey(2)
    e2ee.resetE2eeSession()
    await e2ee.peerPublicKey(2)

    expect(changes).toEqual([])
  })

  it('новый ключ сообщает прежний и текущий ключ', async () => {
    const e2ee = await loadModule()
    const changes: { userId: number; previous: string | null; current: string }[] = []
    e2ee.onPeerKeyChanged((change) => changes.push(change))

    get.mockResolvedValue(keyResponse('{"x":"old"}'))
    await e2ee.peerPublicKey(2)

    e2ee.resetE2eeSession()
    get.mockResolvedValue(keyResponse('{"x":"new"}'))
    await e2ee.peerPublicKey(2)

    expect(changes).toEqual([{ userId: 2, previous: '{"x":"old"}', current: '{"x":"new"}' }])
  })

  it('после подтверждения новый ключ больше не предупреждает', async () => {
    const e2ee = await loadModule()
    const changes: unknown[] = []
    e2ee.onPeerKeyChanged((change) => changes.push(change))

    get.mockResolvedValue(keyResponse('{"x":"old"}'))
    await e2ee.peerPublicKey(2)
    e2ee.resetE2eeSession()
    get.mockResolvedValue(keyResponse('{"x":"new"}'))
    await e2ee.peerPublicKey(2)
    expect(changes.length).toBe(1)

    e2ee.acceptPeerKey(2, '{"x":"new"}')
    e2ee.resetE2eeSession()
    await e2ee.peerPublicKey(2)

    expect(changes.length).toBe(1)
  })

  it('отсутствующий ключ запоминается как «нет ключа» и не сыплет предупреждениями', async () => {
    const e2ee = await loadModule()
    const changes: unknown[] = []
    e2ee.onPeerKeyChanged((change) => changes.push(change))

    get.mockResolvedValue(keyResponse(null))
    expect(await e2ee.peerPublicKey(2)).toBeNull()
    e2ee.resetE2eeSession()
    get.mockResolvedValue(keyResponse(null))
    expect(await e2ee.peerPublicKey(2)).toBeNull()

    expect(changes).toEqual([])
  })

  /**
   * Многоустройность (A5). `public_key` на сервере — это ключ САМОГО СВЕЖЕГО
   * устройства собеседника, поэтому у человека с телефоном и компьютером он
   * законно перескакивает. Живая жалоба 19.09.2026: предупреждение вылезало
   * при каждом входе, сколько бы раз ни нажимать «Понятно».
   */
  it('перескакивание между двумя устройствами предупреждает только один раз', async () => {
    const e2ee = await loadModule()
    const changes: unknown[] = []
    e2ee.onPeerKeyChanged((change) => changes.push(change))

    const keys = ['{"x":"phone"}', '{"x":"laptop"}']
    for (const jwk of [keys[0], keys[1], keys[0], keys[1], keys[0]]) {
      get.mockResolvedValue(keyResponse(jwk))
      e2ee.resetE2eeSession()
      await e2ee.peerPublicKey(2)
    }

    // Первое устройство — молча, второе (незнакомый ключ) — одно предупреждение.
    expect(changes).toEqual([{ userId: 2, previous: '{"x":"phone"}', current: '{"x":"laptop"}' }])
  })

  it('после «Понятно» подтверждённый ключ молчит, даже если ключи чередуются', async () => {
    const e2ee = await loadModule()
    const changes: unknown[] = []
    e2ee.onPeerKeyChanged((change) => changes.push(change))

    get.mockResolvedValue(keyResponse('{"x":"phone"}'))
    await e2ee.peerPublicKey(2)
    e2ee.resetE2eeSession()
    get.mockResolvedValue(keyResponse('{"x":"laptop"}'))
    await e2ee.peerPublicKey(2)
    expect(changes.length).toBe(1)

    e2ee.acceptPeerKey(2, '{"x":"laptop"}')
    for (const jwk of ['{"x":"phone"}', '{"x":"laptop"}', '{"x":"phone"}']) {
      get.mockResolvedValue(keyResponse(jwk))
      e2ee.resetE2eeSession()
      await e2ee.peerPublicKey(2)
    }

    expect(changes.length).toBe(1)
  })

  it('старый формат хранения (один ключ строкой) читается как «уже видели»', async () => {
    // Так выглядит localStorage у человека, который обновил приложение: раньше
    // ключ собеседника лежал одной JSON-строкой, а не массивом.
    window.localStorage.setItem('pismo_e2ee_v1_peer_v1_2', '{"x":"old"}')

    const e2ee = await loadModule()
    const changes: { userId: number; previous: string | null; current: string }[] = []
    e2ee.onPeerKeyChanged((change) => changes.push(change))

    get.mockResolvedValue(keyResponse('{"x":"old"}'))
    await e2ee.peerPublicKey(2)
    expect(changes).toEqual([])

    e2ee.resetE2eeSession()
    get.mockResolvedValue(keyResponse('{"x":"new"}'))
    await e2ee.peerPublicKey(2)

    // Прежний ключ берём из старого формата, а не показываем «нет ключа».
    expect(changes).toEqual([{ userId: 2, previous: '{"x":"old"}', current: '{"x":"new"}' }])
  })
})
