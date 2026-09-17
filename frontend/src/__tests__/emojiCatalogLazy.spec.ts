import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Каталог эмодзи грузится лениво.
 *
 * В нём ~1900 символов (≈5.4 КБ в сжатом виде): если импортировать его статически,
 * он уедет в основной чанк и будет стоить этих килобайт каждому запуску
 * приложения — ради панели, которую открывают не все. Поэтому каталог
 * подтягивается динамическим импортом при открытии панели (как GIF), а этот тест
 * ловит возврат к статическому импорту.
 */
describe('ленивая загрузка каталога эмодзи', () => {
  const composer = readFileSync('src/components/messenger/MessageComposer.vue', 'utf8')

  it('композер импортирует каталог только динамически', () => {
    expect(composer).toContain("import('@/utils/emojiCatalog')")
    // Статический импорт значений запрещён: типы (`import type`) — можно.
    expect(composer).not.toMatch(/^import \{[^}]*EMOJI_CATEGORIES/m)
  })

  it('каталог не тянет в основной чанк ничего лишнего', () => {
    const catalog = readFileSync('src/utils/emojiCatalog.ts', 'utf8')
    expect(catalog).not.toMatch(/^import /m)
  })

  it('диалог паков стикеров тоже ленивый', () => {
    expect(composer).toContain("import('@/components/messenger/StickerPacksDialog.vue')")
    expect(composer).not.toMatch(/^import StickerPacksDialog/m)
  })
})
