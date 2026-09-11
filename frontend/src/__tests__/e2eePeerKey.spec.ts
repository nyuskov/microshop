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
})
