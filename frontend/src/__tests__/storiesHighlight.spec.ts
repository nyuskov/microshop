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
    // Ореол живёт ВНУТРЕННЕЙ линией на самом кружке (`inset`-тень). Раньше линия
    // шла по краю ячейки 40 px (`::after`), и в плотном ряду её дуга выходила
    // серпом из-под соседнего кружка — читалось как подложка позади истории
    // (владелец, 26.09.2026: «тень… она даже без подсказки есть»).
    expect(strip).toContain('.mini.expanded .story-avatar')
    expect(strip).toContain('box-shadow: inset 0 0 0 2px var(--ms-accent)')
    // Наружных линий на ячейке не осталось: иначе тень вернётся.
    expect(strip).not.toContain('.story-cell::after')
  })
})

/**
 * Раскрытие полосы НЕ переживает запуск приложения.
 *
 * Владелец, 24.09.2026: «иногда при открытии приложения истории раскрыты, а
 * поиска нет». Полоса хранилась в `localStorage` и возвращалась раскрытой, а поле
 * поиска — состояние сеанса (его нельзя открывать с фокусом на старте: выехала бы
 * клавиатура). Теперь при открытии шапка всегда сжата.
 */
describe('раскрытие панелей не запоминается', () => {
  it('стартуем с сжатой шапкой', () => {
    expect(sidebar).toContain('const storiesExpanded = ref(false)')
    expect(sidebar).not.toContain('storiesExpanded = ref(readStoriesExpanded())')
  })

  it('в хранилище ничего не пишем, а прежний ключ убираем', () => {
    expect(sidebar).not.toContain("localStorage.setItem('pismo_stories_expanded'")
    expect(sidebar).not.toContain('localStorage.setItem(LEGACY_STORIES_EXPANDED_KEY')
    expect(sidebar).toContain('localStorage.removeItem(LEGACY_STORIES_EXPANDED_KEY)')
  })
})
