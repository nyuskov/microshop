/**
 * Код проверки ключей (safety number) на настоящих ключах, а не на числах.
 *
 * Главное свойство: код у обоих участников совпадает, хотя каждый считает его
 * локально из своего приватного ключа и чужого публичного. Если этого не
 * происходит, сверка «вслух» теряет смысл — и ровно так же становится видно
 * подмену: сервер отдал другой публичный ключ собеседника → коды разошлись.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Ключ собеседника, который «отдал сервер» (подменяется в тестах). */
const serverKeys = new Map<number, string>()

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    api: {
      get: vi.fn(async (url: string) => {
        const id = Number(url.replace(/\D+/g, ''))
        const key = serverKeys.get(id)
        return { data: key ? { has_key: true, public_key: key } : { has_key: false } }
      }),
      put: vi.fn(async () => ({ data: { ok: true } }))
    }
  }
})

import {
  isE2eeAvailable,
  myPublicJwkJson,
  resetE2eeSession,
  safetyNumberWithPeer
} from '@/services/e2ee'

/** Генерирует пару ключей устройства и кладёт её в хранилище под своим id. */
async function makeDevice(userId: number): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits'
  ])
  const [priv, pub] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.privateKey),
    crypto.subtle.exportKey('jwk', pair.publicKey)
  ])
  window.localStorage.setItem(`pismo_e2ee_v1_${userId}`, JSON.stringify({ priv, pub }))
  return JSON.stringify(pub)
}

beforeEach(() => {
  window.localStorage.clear()
  serverKeys.clear()
  resetE2eeSession()
})

describe('safetyNumberWithPeer', () => {
  it('работает в среде тестов (WebCrypto доступен)', () => {
    // Если это упало — окружение тестов не даёт `crypto.subtle`, и проверку
    // ключей в браузере эти тесты не покрывают (нужен другой раннер).
    expect(isE2eeAvailable()).toBe(true)
  })

  it('даёт одинаковый код у обоих участников', async () => {
    const keyA = await makeDevice(1)
    const keyB = await makeDevice(2)
    // Сервер отдаёт каждому публичный ключ другого.
    serverKeys.set(1, keyA)
    serverKeys.set(2, keyB)

    const fromA = await safetyNumberWithPeer(1, 2)
    const fromB = await safetyNumberWithPeer(2, 1)

    expect(fromA).not.toBeNull()
    expect(fromA?.digits).toHaveLength(60)
    expect(fromA?.digits).toBe(fromB?.digits)
  })

  it('совпадает даже если JSON ключа пришёл с другим порядком полей', async () => {
    const keyA = await makeDevice(1)
    const keyB = await makeDevice(2)
    serverKeys.set(1, keyA)
    // Тот же ключ, но поля в другом порядке — код обязан совпасть.
    const shuffled = JSON.stringify({
      y: JSON.parse(keyB).y,
      x: JSON.parse(keyB).x,
      crv: 'P-256',
      kty: 'EC'
    })
    serverKeys.set(2, shuffled)

    const fromA = await safetyNumberWithPeer(1, 2)
    serverKeys.set(2, keyB)
    const fromB = await safetyNumberWithPeer(2, 1)
    expect(fromA?.digits).toBe(fromB?.digits)
  })

  it('расходится, если сервер отдал другую пару ключей (подмена)', async () => {
    await makeDevice(1)
    const keyB = await makeDevice(2)
    serverKeys.set(2, keyB)
    const honest = await safetyNumberWithPeer(1, 2)

    // Ключ «собеседника» подменён на чужой (атакующий в середине).
    serverKeys.delete(2)
    resetE2eeSession()
    const attacker = await makeDevice(3)
    serverKeys.set(2, attacker)
    const mitm = await safetyNumberWithPeer(1, 2)

    expect(mitm?.digits).not.toBe(honest?.digits)
  })

  it('возвращает null, пока собеседник не опубликовал ключ', async () => {
    await makeDevice(1)
    expect(await safetyNumberWithPeer(1, 2)).toBeNull()
  })

  it('работает и когда ключ берётся прямо из хранилища устройства', async () => {
    const keyA = await makeDevice(1)
    const keyB = await makeDevice(2)
    serverKeys.set(2, keyB)
    expect(await myPublicJwkJson(1)).toBe(keyA)
    expect(await safetyNumberWithPeer(1, 2)).not.toBeNull()
  })
})
