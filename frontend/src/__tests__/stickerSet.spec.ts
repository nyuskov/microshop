import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

import { packStickerFileName, presetStickerFileName } from '@/utils/presetStickers'
import { resolveStickerSet, stickerSendRef, type StickerSetRef } from '@/utils/stickerSet'
import { STANDARD_STICKER_PACKS } from '@/utils/standardStickers'
import { effectiveFile } from '@/utils/media'
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

/**
 * E2EE: настоящее имя стикера лежит внутри расшифрованного конверта.
 *
 * В зашифрованном чате сервер хранит вложение под нейтральным именем
 * (`enc_*.bin`) и типом `application/octet-stream`; метку набора клиент достаёт
 * из конверта (`e2ee_file`, см. `effectiveFile`). Пока имя брали напрямую из
 * `message.file.name`, тап по стикеру не находил набор и открывал лайтбокс —
 * «стикер открывается просмотром картинки».
 */
describe('набор стикера в E2EE-чате', () => {
  const encryptedSticker = (name: string) =>
    ({
      file: {
        name: 'enc_0f1e2d.bin',
        url: '/media/enc_0f1e2d.bin',
        mime: 'application/octet-stream',
        size: 10
      },
      e2ee_file: { n: name, m: 'image/webp', s: 10 }
    }) as never

  it('метка читается из расшифрованного имени, а не из `enc_*.bin`', () => {
    const message = encryptedSticker(packStickerFileName(PUBLIC_PACK.id, '1'))

    // Именно так строку читают лента и открытие набора: имя — из эффективного
    // вложения (у E2EE это расшифрованный конверт).
    const set = resolveStickerSet(effectiveFile(message)?.name, [PACK], [PUBLIC_PACK])

    expect(set?.title).toBe('Котики')
    expect(set?.own).toBe(false)
    // По «сырому» имени метки нет — это и был баг.
    expect(resolveStickerSet(message.file?.name, [PACK], [PUBLIC_PACK])).toBeNull()
  })

  it('строки берут имя из эффективного вложения', () => {
    // Тап по стикеру (`openStickerSetOf`) и пункт меню «Добавить набор»
    // (`presetSet`) обязаны смотреть на расшифрованное имя: у E2EE в
    // `message.file.name` только `enc_*.bin`, и метка набора теряется.
    const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
    const openSet = messenger.slice(messenger.indexOf('const openStickerSetOf'))
    const openSetBody = openSet.slice(0, openSet.indexOf('const sendStickerImage'))
    expect(openSetBody).toContain('effectiveFile(message)?.name')
    expect(openSetBody).not.toContain('message.file?.name')

    const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
    expect(row).toContain('presetSetOfFileName(file.value?.name ?? null)')
  })
})

/** Упрощённые заглушки Quasar: важен текст и клик, а не вид. */
const mountDialog = (set: StickerSetRef) =>
  mount(StickerSetDialog, {
    props: { set },
    global: { stubs: { 'q-icon': true } }
  })

describe('просмотр картинки у стикера', () => {
  const bar = readFileSync('src/components/messenger/MessageActionsBar.vue', 'utf8')
  const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')

  it('в меню есть «Открыть как картинку», и оно ведёт в просмотр', () => {
    // Тап по стикеру открывает НАБОР, поэтому сама картинка доступна только отсюда.
    for (const source of [bar]) {
      expect(source).toContain('canOpenImage')
      expect(source).toContain("'Открыть как картинку'")
    }
    // У обычной картинки подпись прежняя.
    expect(bar).toContain("'Открыть изображение'")
    expect(bar).toContain('@click="onOpenImage"')
    expect(row).toContain(':can-open-image="canOpenImage"')
    expect(row).toContain(':has-reminder="Boolean(reminderAt)"')
  })
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
