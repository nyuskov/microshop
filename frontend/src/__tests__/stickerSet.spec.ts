import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

import { packStickerFileName, presetStickerFileName } from '@/utils/presetStickers'
import { resolveStickerSet, stickerSendRef, type StickerSetRef } from '@/utils/stickerSet'
import { STANDARD_STICKER_PACKS } from '@/utils/standardStickers'
import { mediaUrl } from '@/config'
import type { StickerPack } from '@/services/stickers'

/**
 * Набор по стикеру — то, на чём держится окно набора (как в Телеграме).
 *
 * Тап по стикеру должен открывать его набор и давать добавить набор целиком.
 * Набор узнаётся по метке в имени файла: встроенный (`st-…`) — из статики
 * приложения, серверный (`sp-<id>`) — из библиотеки человека или из публичных
 * наборов. Ошибка тут = «ничего не открылось» или чужой набор в окне.
 */

const mocks = vi.hoisted(() => ({
  fetchStickerLibrary: vi.fn(),
  fetchStickerPresets: vi.fn(),
  copyStickerPreset: vi.fn(),
  uploadSticker: vi.fn(),
  createStickerPack: vi.fn()
}))

vi.mock('@/services/stickers', async () => {
  const actual = await vi.importActual<typeof import('@/services/stickers')>('@/services/stickers')
  return { ...mocks, uploadRetryAfterSeconds: actual.uploadRetryAfterSeconds }
})

const { useStickersStore } = await import('@/stores/stickers')
const StickerSetDialog = (await import('@/components/messenger/StickerSetDialog.vue')).default

const PACK: StickerPack = {
  id: 12,
  title: 'Кофе',
  position: 0,
  stickers: [
    { id: 1, file_url: '/media/a.webp', mime_type: 'image/webp', position: 0 },
    { id: 2, file_url: '/media/b.webp', mime_type: null, position: 1 }
  ]
}

const PUBLIC_PACK: StickerPack = { ...PACK, id: 30, title: 'Котики' }

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.fetchStickerLibrary.mockResolvedValue([])
  mocks.fetchStickerPresets.mockResolvedValue([])
  setActivePinia(createPinia())
})

describe('resolveStickerSet', () => {
  it('встроенный набор узнаётся по метке `st-…`', () => {
    const pack = STANDARD_STICKER_PACKS[0]!
    const set = resolveStickerSet(presetStickerFileName(pack.key, pack.stickers[0]!.name), [], [])

    expect(set?.kind).toBe('standard')
    expect(set?.title).toBe(pack.title)
    expect(set?.images).toHaveLength(pack.stickers.length)
    expect(set?.images[0]?.url).toBe(pack.stickers[0]!.url)
    // Своё добавлять нечего, но набор не «свой»: его можно добавить себе.
    expect(set?.own).toBe(false)
  })

  it('свой пак находится в библиотеке, публичный — в публичных наборах', () => {
    const fileName = packStickerFileName(PACK.id, '0')

    const mine = resolveStickerSet(fileName, [PACK], [PUBLIC_PACK])
    expect(mine?.own).toBe(true)
    expect(mine?.title).toBe('Кофе')

    const other = resolveStickerSet(packStickerFileName(PUBLIC_PACK.id, '0'), [PACK], [PUBLIC_PACK])
    expect(other?.own).toBe(false)
    expect(other?.title).toBe('Котики')
    // Картинки отдаются через `/media/…`, тип берём у стикера (у второго он пуст).
    expect(other?.images[0]?.url).toBe(mediaUrl('/media/a.webp'))
    expect(other?.images[0]?.mime).toBe('image/webp')
    expect(other?.images[1]?.mime).toBe('image/webp')
  })

  it('без метки или с неизвестным паком набора нет', () => {
    expect(resolveStickerSet('sticker.webp', [PACK], [PUBLIC_PACK])).toBeNull()
    expect(resolveStickerSet(null, [PACK], [PUBLIC_PACK])).toBeNull()
    // Чужой личный набор: метка есть, а пака у нас нет — обещать нечего.
    expect(resolveStickerSet(packStickerFileName(999, '0'), [PACK], [PUBLIC_PACK])).toBeNull()
  })
})

describe('stickerSendRef', () => {
  it('метка встроенного набора едет в отправку', () => {
    const set = resolveStickerSet(
      presetStickerFileName(
        STANDARD_STICKER_PACKS[0]!.key,
        STANDARD_STICKER_PACKS[0]!.stickers[0]!.name
      ),
      [],
      []
    ) as StickerSetRef

    expect(stickerSendRef(set, set.images[0]!)).toEqual({
      url: set.images[0]!.url,
      mime: set.images[0]!.mime,
      preset: {
        setKey: STANDARD_STICKER_PACKS[0]!.key,
        name: STANDARD_STICKER_PACKS[0]!.stickers[0]!.name
      }
    })
  })

  it('метка серверного набора несёт id пака и позицию', () => {
    const set = resolveStickerSet(packStickerFileName(PACK.id, '1'), [PACK], []) as StickerSetRef

    expect(stickerSendRef(set, set.images[1]!)).toEqual({
      url: mediaUrl('/media/b.webp'),
      mime: 'image/webp',
      pack: { packId: PACK.id, position: 1 }
    })
  })
})

/** Упрощённые заглушки Quasar: важен текст и клик, а не вид. */
const mountDialog = (set: StickerSetRef) =>
  mount(StickerSetDialog, {
    props: { set },
    global: { stubs: { 'q-icon': true } }
  })

describe('окно набора', () => {
  it('показывает название, размер набора и все стикеры', () => {
    const set = resolveStickerSet(packStickerFileName(PACK.id, '0'), [PACK], []) as StickerSetRef
    const wrapper = mountDialog(set)

    expect(wrapper.text()).toContain('Кофе')
    expect(wrapper.text()).toContain('2 шт.')
    expect(wrapper.findAll('.sticker-set-item')).toHaveLength(2)
  })

  it('тап по стикеру отправляет его с меткой набора', async () => {
    const set = resolveStickerSet(
      packStickerFileName(PUBLIC_PACK.id, '0'),
      [],
      [PUBLIC_PACK]
    ) as StickerSetRef
    const wrapper = mountDialog(set)

    await wrapper.findAll('.sticker-set-item')[1]!.trigger('click')

    expect(wrapper.emitted('send')?.[0]?.[0]).toEqual({
      url: mediaUrl('/media/b.webp'),
      mime: 'image/webp',
      pack: { packId: PUBLIC_PACK.id, position: 1 }
    })
  })

  it('у своего набора нет кнопки «Добавить», у публичного — есть', async () => {
    const mine = resolveStickerSet(packStickerFileName(PACK.id, '0'), [PACK], []) as StickerSetRef
    const wrapper = mountDialog(mine)
    expect(wrapper.text()).toContain('Это ваш набор')
    expect(wrapper.find('.sticker-set-add').exists()).toBe(false)

    const preset = resolveStickerSet(
      packStickerFileName(PUBLIC_PACK.id, '0'),
      [],
      [PUBLIC_PACK]
    ) as StickerSetRef
    mocks.copyStickerPreset.mockResolvedValue({ ...PUBLIC_PACK, id: 77 })
    const publicWrapper = mountDialog(preset)
    const button = publicWrapper.find('.sticker-set-add')
    expect(button.exists()).toBe(true)

    await button.trigger('click')

    // Серверный набор копируется ОДНИМ запросом — без загрузки картинок.
    expect(mocks.copyStickerPreset).toHaveBeenCalledWith(PUBLIC_PACK.id)
    await Promise.resolve()
    // Копия появилась в библиотеке — окно показывает «Добавлен».
    expect(useStickersStore().packs.some((pack) => pack.title === PUBLIC_PACK.title)).toBe(true)
  })

  it('уже добавленный публичный набор не предлагается второй раз', () => {
    const store = useStickersStore()
    store.packs = [{ ...PUBLIC_PACK, id: 55 }]
    const preset = resolveStickerSet(
      packStickerFileName(PUBLIC_PACK.id, '0'),
      [],
      [PUBLIC_PACK]
    ) as StickerSetRef

    const wrapper = mountDialog(preset)

    expect(wrapper.text()).toContain('Добавлен')
    expect(wrapper.find('.sticker-set-add').exists()).toBe(false)
  })
})
