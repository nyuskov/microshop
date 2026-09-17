import { describe, expect, it } from 'vitest'

import { EMOJI_CATEGORIES, emojiCategoryByKey } from '@/utils/emojiCatalog'

/**
 * Каталог эмодзи (файл генерируется `scripts/build-emoji-catalog.py`).
 *
 * Проверяем то, что легко сломать при обновлении источника: категории непустые,
 * ключи уникальны, эмодзи не повторяются между категориями (иначе один и тот же
 * смайл висел бы в двух вкладках), и каталог действительно большой — панель
 * должна давать весь набор, а не десяток символов.
 */
describe('каталог эмодзи', () => {
  it('категории идут в привычном порядке и все непустые', () => {
    expect(EMOJI_CATEGORIES.map((category) => category.key)).toEqual([
      'smileys',
      'people',
      'nature',
      'food',
      'travel',
      'activities',
      'objects',
      'symbols',
      'flags'
    ])
    for (const category of EMOJI_CATEGORIES) {
      expect(category.items.length, category.key).toBeGreaterThan(50)
      expect(category.title.length).toBeGreaterThan(0)
      // Значок вкладки — первый эмодзи группы, отдельной иконки не нужно.
      expect(category.icon).toBe(category.items[0])
    }
  })

  it('эмодзи не повторяются внутри категории и между ними', () => {
    const all = EMOJI_CATEGORIES.flatMap((category) => category.items)
    expect(new Set(all).size).toBe(all.length)
  })

  it('варианты с цветом кожи не попали в каталог', () => {
    // Иначе «👍🏻👍🏼👍🏽» занимали бы три клетки из одного и того же жеста.
    const skinTones = /[\u{1F3FB}-\u{1F3FF}]/u
    for (const category of EMOJI_CATEGORIES) {
      expect(
        category.items.some((item) => skinTones.test(item)),
        category.key
      ).toBe(false)
    }
  })

  it('набор заметно больше прежнего рукописного списка', () => {
    const total = EMOJI_CATEGORIES.reduce((sum, category) => sum + category.items.length, 0)
    expect(total).toBeGreaterThan(1500)
  })

  it('категория ищется по ключу', () => {
    expect(emojiCategoryByKey('smileys')?.title).toBe('Смайлы')
    expect(emojiCategoryByKey('нет-такой')).toBeUndefined()
  })
})
