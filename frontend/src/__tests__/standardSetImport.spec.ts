import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * «Добавить весь набор» — как «ДОБАВИТЬ СТИКЕРЫ» в Телеграме.
 *
 * Встроенный набор лежит статикой в приложении, поэтому добавление — это
 * скачать картинки и загрузить их своим паком. Проверяем три вещи, которые
 * легко сломать: набор становится СВОИМ паком, «Недавние» им не забиваются, а
 * отметка «добавлен» появляется только при полном успехе (иначе кнопка сказала
 * бы «Добавлен», а половины стикеров не было).
 */

const mocks = vi.hoisted(() => ({
  fetchStickerLibrary: vi.fn(),
  createStickerPack: vi.fn(),
  updateStickerPack: vi.fn(),
  deleteStickerPack: vi.fn(),
  deleteSticker: vi.fn(),
  uploadSticker: vi.fn(),
  fetchStandardStickerFile: vi.fn()
}))

vi.mock('@/services/stickers', async () => {
  // Функции API подменяем, но разбор 429 (`uploadRetryAfterSeconds`) берём
  // настоящий: это чистая функция, и на ней держится пережидание лимита.
  const actual = await vi.importActual<typeof import('@/services/stickers')>('@/services/stickers')
  return { ...mocks, uploadRetryAfterSeconds: actual.uploadRetryAfterSeconds }
})

const { useStickersStore } = await import('@/stores/stickers')

const SET = {
  key: 'reactions',
  title: 'Реакции',
  stickers: [
    { name: 'ok', url: '/stickers/reactions/ok.png', label: 'Ок' },
    { name: 'yes', url: '/stickers/reactions/yes.png', label: 'Да' }
  ]
}

let nextStickerId = 1

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  nextStickerId = 1
  mocks.fetchStickerLibrary.mockResolvedValue([])
  mocks.createStickerPack.mockImplementation(async (title: string) => ({
    id: 10,
    title,
    position: 0,
    stickers: []
  }))
  mocks.uploadSticker.mockImplementation(async (_packId: number) => ({
    id: nextStickerId++,
    file_url: `/media/sticker-${nextStickerId}.webp`,
    mime_type: 'image/webp',
    position: 0
  }))
  mocks.fetchStandardStickerFile.mockImplementation(
    async (sticker: { url: string }) =>
      new File([new Uint8Array([1, 2, 3])], sticker.url.split('/').pop() ?? 'x.png', {
        type: 'image/png'
      })
  )
  setActivePinia(createPinia())
})

describe('importStandardSet', () => {
  it('кладёт весь набор своим паком и помечает его добавленным', async () => {
    const store = useStickersStore()
    const progress: number[] = []

    const result = await store.importStandardSet(SET, (done) => progress.push(done))

    expect(result.added).toBe(2)
    expect(result.failed).toBe(0)
    expect(mocks.createStickerPack).toHaveBeenCalledWith('Реакции')
    expect(mocks.uploadSticker).toHaveBeenCalledTimes(2)
    // Набор стал обычным паком: его стикеры лежат в библиотеке.
    expect(store.packs[0].stickers).toHaveLength(2)
    expect(store.isStandardSetImported('reactions')).toBe(true)
    // Прогресс: 0 перед началом, затем по одному на каждый стикер.
    expect(progress).toEqual([0, 1, 2])
  })

  it('не забивает «Недавние» целым набором', async () => {
    const store = useStickersStore()

    await store.importStandardSet(SET)

    expect(store.recent).toEqual([])
    expect(store.recentIds).toEqual([])
  })

  it('при частичном сбое пак остаётся, но отметки «добавлен» нет', async () => {
    const store = useStickersStore()
    mocks.uploadSticker.mockImplementationOnce(async () => {
      throw new Error('Файл слишком большой')
    })

    const result = await store.importStandardSet(SET)

    expect(result.added).toBe(1)
    expect(result.failed).toBe(1)
    expect(store.packs[0].stickers).toHaveLength(1)
    // Набор можно добавить ещё раз — кнопка не должна говорить «Добавлен».
    expect(store.isStandardSetImported('reactions')).toBe(false)
  })

  it('после удаления пака набор снова можно добавить', async () => {
    const store = useStickersStore()
    await store.importStandardSet(SET)
    expect(store.isStandardSetImported('reactions')).toBe(true)

    await store.removePack(store.packs[0].id)

    expect(store.isStandardSetImported('reactions')).toBe(false)
  })

  it('пережидает лимит загрузок (429) и доводит набор до конца', async () => {
    // Сервер принимает 10 загрузок в минуту: на 11-м файле набора приходит 429
    // с `Retry-After`. Для человека это одно действие — набор должен доехать.
    vi.useFakeTimers()
    try {
      const store = useStickersStore()
      mocks.uploadSticker.mockRejectedValueOnce(
        Object.assign(new Error('Слишком много загрузок'), {
          response: { status: 429, headers: { 'retry-after': '60' } }
        })
      )

      const waits: number[] = []
      const promise = store.importStandardSet(SET, undefined, (seconds) => waits.push(seconds))
      await vi.advanceTimersByTimeAsync(61_000)
      const result = await promise

      expect(result.added).toBe(2)
      expect(result.failed).toBe(0)
      // Первая попытка — отказ по лимиту, затем два успешных файла.
      expect(mocks.uploadSticker).toHaveBeenCalledTimes(3)
      // Наружу видно и ожидание, и его конец (кнопка показывает счётчик).
      expect(waits).toEqual([60, 0])
    } finally {
      vi.useRealTimers()
    }
  })
})
