import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Все горизонтальные ленты листаются одинаково.
 *
 * Повод: пользователь дважды сообщал, что элементы лент «куда-то уходят, их не
 * видно» — сначала про ряд папок, потом про категории эмодзи и другие полосы.
 * Свайп пальцем браузер делает сам, а в веб-версии обычное колесо мыши крутило
 * список, и до правого края было не добраться.
 *
 * Поэтому механизм один — `composables/useHScroll.ts` (колесо + перетаскивание +
 * края-затухание), и он должен быть подключён к КАЖДОЙ ленте. Сломать это легко:
 * достаточно добавить новую полосу без обработчиков — она снова «уедет».
 */

const source = (path: string) => readFileSync(path, 'utf8')

const lanes = [
  ['src/components/messenger/ChatList.vue', 'чипы фильтров и папки'],
  ['src/components/messenger/MessageComposer.vue', 'категории эмодзи и стикеров'],
  ['src/components/stories/StoriesStrip.vue', 'полоса историй'],
  ['src/components/media/GifPicker.vue', 'быстрые запросы GIF'],
  ['src/components/channels/ChannelInfoDialog.vue', 'вкладки карточки канала']
] as const

describe('общий механизм прокрутки лент', () => {
  it('колесо переводится в горизонталь, мышь тянет ленту', () => {
    const composable = source('src/composables/useHScroll.ts')
    expect(composable).toContain('wheelScrollLeft(node, event.deltaX, event.deltaY)')
    expect(composable).toContain('dragScrollLeft(node, dragStartLeft, dx)')
    // Мышь тянет, палец — свайпом (браузер делает это сам).
    expect(composable).toContain("if (event.pointerType !== 'mouse') return")
  })

  it('после протяжки клик по элементу не срабатывает', () => {
    const composable = source('src/composables/useHScroll.ts')
    expect(composable).toContain('wasDragged')
    expect(composable).toContain('suppressClick = true')
  })

  it('на лентах показываем затухание только у того края, где есть скрытое', () => {
    const composable = source('src/composables/useHScroll.ts')
    expect(composable).toContain('edges.value = scrollEdges(node)')
  })

  it.each(lanes)('%s (%s) подключена к прокрутке', (path) => {
    const file = source(path)
    expect(file).toContain('useHScroll(')
    expect(file).toContain('@wheel.passive=')
    expect(file).toContain('@pointerdown=')
    expect(file).toContain('@pointermove=')
    expect(file).toContain('fade-end')
  })
})

describe('полосы не отбирают жесты у списка', () => {
  it('лента не тянет за собой страницу при достижении края', () => {
    // Иначе докрутка ленты у края уводила бы список чатов.
    const list = source('src/components/messenger/ChatList.vue')
    expect(list).toContain('overscroll-behavior-x: contain')
  })
})
