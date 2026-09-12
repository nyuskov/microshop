/**
 * Отложенная расшифровка вложений E2EE.
 *
 * Строка сообщения просит расшифровку только когда дошла до экрана. Проверяем
 * именно это: до появления файл не скачивается, после — скачивается один раз,
 * а пока не разрешено, состояние остаётся «расшифровываем» (вернуть null нельзя:
 * разметка взяла бы шифротекст и показала его как обычное вложение).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const decryptFileBlob = vi.fn()

vi.mock('@/services/e2eeFiles', () => ({
  decryptFileBlob: (...args: unknown[]) => decryptFileBlob(...args)
}))

vi.mock('@/config', () => ({
  mediaUrl: (path: string) => `https://media.test${path}`
}))

/** Заглушка сообщения: функции нужны только `id`, `file` и `e2ee_file`. */
const message = (id = 1) =>
  ({
    id,
    file: {
      url: `/media/enc_${id}.bin`,
      name: 'enc.bin',
      mime: 'application/octet-stream',
      size: 3
    },
    e2ee_file: { n: 'photo.jpg', m: 'image/jpeg', s: 3 }
  }) as never

/** Импорт «с чистого листа»: кэш расшифрованных вложений живёт в модуле. */
async function loadModule() {
  vi.resetModules()
  return await import('@/composables/useDecryptedMedia')
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  decryptFileBlob.mockReset()
  decryptFileBlob.mockResolvedValue(new Blob(['abc'], { type: 'image/jpeg' }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(3) }))
  )
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:расшифровано') })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('decryptedMediaFor: отложенный старт', () => {
  it('пока строка не видна, файл не скачивается и состояние — «расшифровываем»', async () => {
    const { decryptedMediaFor } = await loadModule()
    const media = decryptedMediaFor(message(), { enabled: () => false })

    expect(media?.status).toBe('loading')
    expect(fetch).not.toHaveBeenCalled()
    expect(decryptFileBlob).not.toHaveBeenCalled()
  })

  it('после появления на экране файл скачивается и расшифровывается', async () => {
    const { decryptedMediaFor } = await loadModule()
    let visible = false
    const options = { enabled: () => visible }

    expect(decryptedMediaFor(message(), options)?.status).toBe('loading')
    expect(fetch).not.toHaveBeenCalled()

    visible = true
    decryptedMediaFor(message(), options)
    await flush()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(decryptFileBlob).toHaveBeenCalledTimes(1)
    expect(decryptedMediaFor(message(), options)).toMatchObject({
      status: 'ready',
      url: 'blob:расшифровано'
    })
  })

  it('повторные вызовы не запускают вторую загрузку', async () => {
    const { decryptedMediaFor } = await loadModule()
    decryptedMediaFor(message(), { enabled: () => true })
    decryptedMediaFor(message(), { enabled: () => true })
    decryptedMediaFor(message(), { enabled: () => true })
    await flush()

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('без опции enabled ведёт себя как раньше — грузит сразу', async () => {
    const { decryptedMediaFor } = await loadModule()
    decryptedMediaFor(message())
    await flush()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(decryptFileBlob).toHaveBeenCalledTimes(1)
  })

  it('незашифрованное вложение расшифровкой не занимается', async () => {
    const { decryptedMediaFor } = await loadModule()
    const plain = { id: 2, file: { url: '/media/plain.jpg' } } as never

    expect(decryptedMediaFor(plain, { enabled: () => false })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('разные сообщения расшифровываются независимо', async () => {
    const { decryptedMediaFor } = await loadModule()
    decryptedMediaFor(message(1), { enabled: () => true })
    decryptedMediaFor(message(2), { enabled: () => true })
    await flush()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledWith('https://media.test/media/enc_1.bin')
    expect(fetch).toHaveBeenCalledWith('https://media.test/media/enc_2.bin')
  })
})
