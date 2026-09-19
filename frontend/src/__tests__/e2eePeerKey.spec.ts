/**
 * Смена ключа собеседника (TOFU) — предупреждение о возможном перехвате.
 *
 * Ключ E2EE привязан к устройству и меняется при входе с нового телефона — это
 * нормально. Ровно так же выглядит подмена ключа тем, кто получил доступ к
 * аккаунту собеседника и хочет читать переписку (MITM). Клиент это различает
 * только одним способом: помнит, какие ключи и устройства видел раньше, и
 * спрашивает человека.
 *
 * Проверяем два главных правила (они появились после живой жалобы 19.09.2026,
 * когда предупреждение вылезало при каждом входе):
 * - у собеседника несколько устройств, и «самый свежий» ключ на сервере
 *   законно перескакивает — это НЕ повод предупреждать;
 * - знакомый ключ (в том числе подтверждённый кнопкой «Понятно») молчит навсегда,
 *   поэтому предупреждение не может вернуться.
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

interface FakeDevice {
  device_id: string
  public_key: string
}

/** Ответ `GET /keys/{id}/`: список устройств и ключ самого свежего из них. */
const keyResponse = (devices: FakeDevice[]) => ({
  data: {
    user_id: 2,
    has_key: devices.length > 0,
    public_key: devices[0]?.public_key ?? null,
    devices
  }
})

const device = (id: string, key: string): FakeDevice => ({ device_id: id, public_key: key })

interface Change {
  userId: number
  previous: string | null
  current: string
  deviceId: string | null
}

describe('peerPublicKey — отслеживание смены ключа собеседника', () => {
  let changes: Change[]

  beforeEach(() => {
    get.mockReset()
    window.localStorage.clear()
    changes = []
  })

  /** Загружает модуль и подписывается на предупреждения. */
  const listen = async () => {
    const e2ee = await loadModule()
    e2ee.onPeerKeyChanged((change) => changes.push(change as Change))
    return e2ee
  }

  /** Один запрос ключа собеседника «с чистого листа» (кэши сбрасываем). */
  const fetchKey = async (
    e2ee: Awaited<ReturnType<typeof loadModule>>,
    devices: FakeDevice[]
  ): Promise<string | null> => {
    get.mockResolvedValue(keyResponse(devices))
    e2ee.resetE2eeSession()
    return await e2ee.peerPublicKey(2)
  }

  it('первый ключ собеседника — не повод предупреждать', async () => {
    const e2ee = await listen()

    expect(await fetchKey(e2ee, [device('d1', '{"x":"first"}')])).toBe('{"x":"first"}')
    expect(changes).toEqual([])
  })

  it('тот же список устройств второй раз предупреждения не вызывает', async () => {
    const e2ee = await listen()
    const devices = [device('d1', '{"x":"same"}')]

    await fetchKey(e2ee, devices)
    await fetchKey(e2ee, devices)

    expect(changes).toEqual([])
  })

  /**
   * Главная причина жалобы: `public_key` на сервере — ключ САМОГО СВЕЖЕГО
   * устройства, поэтому у человека с телефоном и компьютером он перескакивает.
   */
  it('новое устройство собеседника (свежий ключ впереди) предупреждения не даёт', async () => {
    const e2ee = await listen()

    await fetchKey(e2ee, [device('phone', '{"x":"phone"}')])
    // Собеседник вошёл с компьютера: его ключ стал «самым свежим».
    await fetchKey(e2ee, [device('laptop', '{"x":"laptop"}'), device('phone', '{"x":"phone"}')])
    // И ещё раз туда-обратно — сколько угодно раз.
    await fetchKey(e2ee, [device('phone', '{"x":"phone"}')])
    await fetchKey(e2ee, [device('laptop', '{"x":"laptop"}'), device('phone', '{"x":"phone"}')])

    expect(changes).toEqual([])
  })

  it('смена ключа у знакомого устройства сообщает прежний и текущий ключ', async () => {
    const e2ee = await listen()

    await fetchKey(e2ee, [device('d1', '{"x":"old"}')])
    await fetchKey(e2ee, [device('d1', '{"x":"new"}')])

    expect(changes).toEqual([
      { userId: 2, previous: '{"x":"old"}', current: '{"x":"new"}', deviceId: 'd1' }
    ])
  })

  it('после подтверждения смена ключа того же устройства больше не предупреждает', async () => {
    const e2ee = await listen()

    await fetchKey(e2ee, [device('d1', '{"x":"old"}')])
    await fetchKey(e2ee, [device('d1', '{"x":"new"}')])
    expect(changes.length).toBe(1)

    const change = changes[0]
    e2ee.acceptPeerKey(change.userId, change.deviceId, change.current)
    await fetchKey(e2ee, [device('d1', '{"x":"new"}')])
    // Вернулся к прежнему ключу — он тоже знаком, молчим.
    await fetchKey(e2ee, [device('d1', '{"x":"old"}')])

    expect(changes.length).toBe(1)
  })

  /**
   * Устройства старого клиента помечены одной меткой `legacy`, поэтому за ней
   * могут стоять разные ключи разных браузеров. Раньше это давало предупреждение
   * на каждом переключении — здесь проверяем, что оно приходит один раз.
   */
  it('чередование ключей у метки legacy предупреждает один раз', async () => {
    const e2ee = await listen()

    await fetchKey(e2ee, [device('legacy', '{"x":"old-browser"}')])
    for (const key of [
      '{"x":"another-browser"}',
      '{"x":"old-browser"}',
      '{"x":"another-browser"}'
    ]) {
      await fetchKey(e2ee, [device('legacy', key)])
    }

    expect(changes.length).toBe(1)
    expect(changes[0]?.current).toBe('{"x":"another-browser"}')
  })

  it('если знакомых устройств не осталось — «сменилась личность» и мы предупреждаем', async () => {
    const e2ee = await listen()

    await fetchKey(e2ee, [device('phone', '{"x":"phone"}')])
    await fetchKey(e2ee, [device('attacker', '{"x":"other"}')])

    expect(changes).toEqual([
      { userId: 2, previous: '{"x":"phone"}', current: '{"x":"other"}', deviceId: 'attacker' }
    ])
  })

  it('ключ, подтверждённый в прежней версии приложения, не предупреждает', async () => {
    // Так выглядит localStorage у человека, который обновил приложение:
    // раньше подтверждённый ключ собеседника лежал одной строкой под другим именем.
    window.localStorage.setItem('pismo_e2ee_peer_ok_v1_2', '{"x":"old"}')
    const e2ee = await listen()

    await fetchKey(e2ee, [device('d1', '{"x":"old"}')])
    expect(changes).toEqual([])

    // А незнакомый ключ из старой памяти всё равно спросит.
    await fetchKey(e2ee, [device('d1', '{"x":"new"}')])
    expect(changes).toEqual([
      { userId: 2, previous: '{"x":"old"}', current: '{"x":"new"}', deviceId: 'd1' }
    ])
  })

  it('старый сервер без списка устройств считается одним устройством legacy', async () => {
    const e2ee = await listen()

    get.mockResolvedValue({ data: { user_id: 2, has_key: true, public_key: '{"x":"old"}' } })
    expect(await e2ee.peerPublicKey(2)).toBe('{"x":"old"}')
    expect(changes).toEqual([])

    get.mockResolvedValue({ data: { user_id: 2, has_key: true, public_key: '{"x":"new"}' } })
    e2ee.resetE2eeSession()
    expect(await e2ee.peerPublicKey(2)).toBe('{"x":"new"}')
    expect(changes).toEqual([
      { userId: 2, previous: '{"x":"old"}', current: '{"x":"new"}', deviceId: 'legacy' }
    ])
  })

  it('отсутствующий ключ запоминается как «нет ключа» и не сыплет предупреждениями', async () => {
    const e2ee = await listen()

    expect(await fetchKey(e2ee, [])).toBeNull()
    expect(await fetchKey(e2ee, [])).toBeNull()

    expect(changes).toEqual([])
  })
})
