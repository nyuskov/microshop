import { describe, expect, it } from 'vitest'

import {
  packIdOfFileName,
  packStickerFileName,
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

/**
 * Метка набора С СЕРВЕРА (`sp-<id пака>-<позиция>.png`).
 *
 * Нужна для своих и публичных наборов: по ней тап по стикеру в ленте открывает
 * набор целиком. Встроенная метка (`st-…`) и серверная не должны путаться.
 */
describe('метка серверного набора', () => {
  it('имя файла собирается и разбирается обратно', () => {
    expect(packStickerFileName(42, '3')).toBe('sp-42-3.png')
    expect(packIdOfFileName('sp-42-3.png')).toBe(42)
    expect(packIdOfFileName('sp-7-1.png')).toBe(7)
  })

  it('метки встроенного набора за серверную не считаются', () => {
    expect(packIdOfFileName('st-reactions-ok.png')).toBeNull()
    expect(packIdOfFileName('sticker.webp')).toBeNull()
    expect(packIdOfFileName('photo.jpg')).toBeNull()
    expect(packIdOfFileName(null)).toBeNull()
    expect(packIdOfFileName(undefined)).toBeNull()
  })

  it('битая метка набора не даёт', () => {
    // Без числа, с нулём и с мусором вместо id — набора нет, а не падение.
    expect(packIdOfFileName('sp-.png')).toBeNull()
    expect(packIdOfFileName('sp-0-1.png')).toBeNull()
    expect(packIdOfFileName('sp--1-1.png')).toBeNull()
    expect(packIdOfFileName('sp-abc-1.png')).toBeNull()
  })
})
