import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Поиск по сообщениям внутри чата: переходы и подсветка.
 *
 * Раскладку и видимость jsdom не считает, поэтому проверяем разметку/логику по
 * исходникам: у строки поиска должны быть счётчик и стрелки, Enter должен
 * листать совпадения, а запрос — доходить до текста сообщения (подсветка).
 */
const bar = readFileSync('src/components/messenger/InlineSearchBar.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
const thread = readFileSync('src/components/messenger/MessageThread.vue', 'utf8')
const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')

describe('строка поиска по сообщениям', () => {
  it('показывает, на каком совпадении мы стоим', () => {
    expect(bar).toMatch(/\(current \?\? 0\) > 0/)
    expect(bar).toMatch(/t\('\{current\} из \{count\}', \{ current: current \?\? 0, count \}\)/)
    expect(bar).toMatch(/role="status"/)
  })

  it('листает совпадения стрелками и с клавиатуры', () => {
    expect(bar).toMatch(/@keydown\.enter\.exact\.prevent="emit\('next'\)"/)
    expect(bar).toMatch(/@keydown\.enter\.shift\.prevent="emit\('prev'\)"/)
    expect(bar).toMatch(/emit\('next'\)/)
    expect(bar).toMatch(/emit\('prev'\)/)
  })

  it('стрелки появляются только когда есть куда ходить', () => {
    expect(bar).toMatch(/v-if="count > 1"/)
  })
})

describe('переходы по совпадениям в Messenger', () => {
  it('хранит список совпадений и ходит по кругу', () => {
    expect(messenger).toMatch(/const inlineMatches = ref<\{ id: number \}\[\]>\(\[\]\)/)
    expect(messenger).toMatch(
      /inlineMatchIndex\.value = \(inlineMatchIndex\.value \+ delta \+ total\) % total/
    )
  })

  it('переход догружает историю, если совпадение ещё не загружено', () => {
    // Поиск серверный: найденное сообщение может быть в не загруженной части
    // истории — прямое обращение к ленте показало бы пустоту.
    expect(messenger).toMatch(/const loaded = await ensureMessageLoaded\(match\.id\)/)
    expect(messenger).toMatch(/if \(loaded\) await revealMessageInThread\(match\.id\)/)
  })

  it('сначала показывает самое свежее совпадение', () => {
    expect(messenger).toMatch(/inlineMatchIndex\.value = results\.length - 1/)
  })

  it('сбрасывает совпадения, когда запрос очистили', () => {
    expect(messenger.match(/inlineMatches\.value = \[\]/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe('подсветка совпадений в ленте', () => {
  it('запрос доходит до строки сообщения', () => {
    expect(messenger).toMatch(/:search-query="inlineSearchOpen \? inlineQuery\.trim\(\) : ''"/)
    expect(thread).toMatch(/:search-query="searchQuery"/)
    expect(row).toMatch(/highlightQuery\(splitMessageText\(props\.message\.text \?\? ''\)/)
  })

  it('совпадение рисуется тегом mark, а не разметкой из текста', () => {
    expect(row).toMatch(/<mark v-else-if="part\.type === 'search'"/)
    expect(row).not.toMatch(/v-html/)
  })
})
