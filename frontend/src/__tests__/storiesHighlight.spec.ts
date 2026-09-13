import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Подсветка кружка историй в шапке.
 *
 * Пока полоса историй раскрыта, кружок в шапке должен читаться как «включённый» —
 * так же, как значок поиска в открытом состоянии. Проверки статические (jsdom не
 * считает раскладку), поэтому читаем исходники: важно, чтобы признак раскрытия
 * (`expanded`) не потерялся при следующих правках.
 */

const strip = readFileSync('src/components/stories/StoriesStrip.vue', 'utf8')
const sidebar = readFileSync('src/components/messenger/ChatSidebar.vue', 'utf8')

describe('кружок историй в шапке', () => {
  it('полоса сообщает кружку, что раскрыта', () => {
    expect(sidebar).toContain(':expanded="storiesExpanded"')
  })

  it('в сжатом виде признак превращается в класс expanded', () => {
    expect(strip).toContain(':class="{ mini, expanded: mini && expanded }"')
  })

  it('раскрытая полоса рисует акцентный ореол', () => {
    expect(strip).toContain('.mini.expanded .story-cell::after')
    expect(strip).toContain('border-width: 2px')
  })
})
