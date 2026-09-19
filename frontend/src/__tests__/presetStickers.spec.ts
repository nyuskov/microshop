import { describe, expect, it } from 'vitest'

import {
  presetSetKeyOfFileName,
  presetSetOfFileName,
  presetStickerFileName
} from '@/utils/presetStickers'
import { STANDARD_STICKER_PACKS } from '@/utils/standardStickers'

/**
 * Метка набора в имени файла стикера.
 *
 * На ней держится пункт «Добавить набор» в меню стикера: у сервера
 * предустановленных наборов нет (это статика приложения), поэтому единственный
 * способ понять, из какого набора пришёл стикер, — метка в имени файла, которое
 * доезжает до получателя как `file.name` (в E2EE — внутри расшифрованного конверта).
 */
describe('метка предустановленного набора', () => {
  it('имя файла собирается и разбирается обратно', () => {
    for (const pack of STANDARD_STICKER_PACKS) {
      const sticker = pack.stickers[0]
      const name = presetStickerFileName(pack.key, sticker.name)

      expect(name).toBe(`st-${pack.key}-${sticker.name}.png`)
      expect(presetSetKeyOfFileName(name)).toBe(pack.key)
      expect(presetSetOfFileName(name)?.title).toBe(pack.title)
    }
  })

  it('свои стикеры, вложения и незнакомые наборы набора не дают', () => {
    expect(presetSetKeyOfFileName('sticker.webp')).toBeNull()
    expect(presetSetKeyOfFileName(null)).toBeNull()
    expect(presetSetKeyOfFileName(undefined)).toBeNull()
    expect(presetSetKeyOfFileName('st-unknown-pack.png')).toBeNull()
    expect(presetSetOfFileName('photo.jpg')).toBeNull()
  })

  it('ключ набора не содержит дефисов — иначе метка разбиралась бы неверно', () => {
    for (const pack of STANDARD_STICKER_PACKS) {
      expect(pack.key).not.toContain('-')
      for (const sticker of pack.stickers) {
        const name = presetStickerFileName(pack.key, sticker.name)
        expect(presetSetKeyOfFileName(name)).toBe(pack.key)
      }
    }
  })
})
