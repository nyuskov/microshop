import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { STANDARD_STICKER_PACKS } from '@/utils/standardStickers'

/**
 * Стандартные стикеры приложения.
 *
 * Это наши собственные картинки из `public/stickers/`: они есть у всех сразу,
 * поэтому их нельзя удалить, и они не появляются в окне «Мои стикеры». Каталог
 * генерируется (`scripts/build-standard-stickers.py`), поэтому проверяем не
 * «красоту», а связность: файл по каждой ссылке действительно лежит, подписи
 * есть (иначе скринридер прочитает пустоту).
 */
describe('стандартные стикеры', () => {
  it('есть хотя бы один непустой набор', () => {
    expect(STANDARD_STICKER_PACKS.length).toBeGreaterThan(0)
    for (const pack of STANDARD_STICKER_PACKS) {
      expect(pack.key).toMatch(/^[a-z0-9-]+$/)
      expect(pack.title.length).toBeGreaterThan(0)
      expect(pack.stickers.length).toBeGreaterThan(0)
    }
  })

  it('файлы стикеров лежат в public и на месте', () => {
    for (const pack of STANDARD_STICKER_PACKS) {
      for (const sticker of pack.stickers) {
        const file = path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'public',
          sticker.url.replace(/^\//, '')
        )
        expect(existsSync(file), `${sticker.url} отсутствует`).toBe(true)
      }
    }
  })

  it('у каждого стикера есть подпись, а пути не повторяются', () => {
    const urls = new Set<string>()
    for (const pack of STANDARD_STICKER_PACKS) {
      for (const sticker of pack.stickers) {
        expect(sticker.label.length).toBeGreaterThan(0)
        expect(sticker.url.startsWith('/stickers/')).toBe(true)
        expect(urls.has(sticker.url)).toBe(false)
        urls.add(sticker.url)
      }
    }
  })
})
