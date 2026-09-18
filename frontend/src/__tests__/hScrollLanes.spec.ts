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
  ['src/components/messenger/MessageComposer.vue', 'лента категорий эмодзи и паков'],
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

  it.each(lanes)('%s (%s) отдаёт свой элемент composable', (path) => {
    // Грабля: обработчики в разметке есть, а элемент в composable не передан —
    // тогда перетаскивание мышью и затухания краёв молча не делают ничего, и
    // лента выглядит непрокручиваемой (ровно так и случилось в панели эмодзи).
    const file = source(path)
    const destructured = /el:\s*([A-Za-z0-9_]+)\s*,/.exec(file)?.[1] ?? null
    const spread = /:ref="([A-Za-z0-9_]+)\.el"/.exec(file)?.[1] ?? null
    expect(destructured ?? spread, 'элемент не передан в useHScroll').toBeTruthy()
    if (destructured) expect(file).toContain(`ref="${destructured}"`)
    if (spread) expect(file).toContain(`...${spread}`)
  })
})

describe('полосы не отбирают жесты у списка', () => {
  it('лента не тянет за собой страницу при достижении края', () => {
    // Иначе докрутка ленты у края уводила бы список чатов.
    const list = source('src/components/messenger/ChatList.vue')
    expect(list).toContain('overscroll-behavior-x: contain')
  })
})

describe('панели эмодзи и стикеров — лента плюс столбик', () => {
  it('лента значков ведёт к секциям, содержимое лежит столбиком', () => {
    // Как в Telegram: полоса значков (категории эмодзи, паки стикеров) служит
    // быстрым переходом, а содержимое идёт вертикальным списком секций —
    // вкладок, которые прячут всё, кроме одной категории, больше нет.
    const composer = source('src/components/messenger/MessageComposer.vue')
    expect(composer).toContain('class="panel-strip"')
    expect(composer).toContain('jumpToSection')
    expect(composer).toContain('class="panel-scroll"')
    expect(composer).toContain('<PanelSection')
    expect(composer).toContain('data-section')
  })

  it('лента подсвечивает секцию, которая сейчас на экране', () => {
    const composer = source('src/components/messenger/MessageComposer.vue')
    expect(composer).toContain('onPanelScroll')
    expect(composer).toContain("querySelectorAll<HTMLElement>('[data-section]')")
    expect(composer).toContain('panel-strip-item.active')
  })

  it('переход к секции считает позицию внутри контейнера прокрутки', () => {
    // Грабля: `offsetTop` отмеряется от ближайшего позиционированного предка, а им
    // для секций был `.extras-menu` — над списком лежат вкладки, полоса
    // «Добавить/Паки» и лента значков. Переход уезжал вниз ровно на их высоту:
    // заголовок оставался за верхом, а короткая группа («Недавние», небольшой
    // пак) не попадала на экран.
    const composer = source('src/components/messenger/MessageComposer.vue')
    expect(composer).toContain('sectionOffsetTop')
    expect(composer).not.toContain('top: section.offsetTop')
    // И до цели секции показываются заранее: у ленивой секции высота ещё
    // неизвестна, из-за чего позиция для перехода и была неверной.
    expect(composer).toContain('forcedSectionsUpTo')
    expect(composer).toContain(':force="index <= forcedSectionsUpTo"')
    expect(source('src/components/messenger/PanelSection.vue')).toContain('visible || force')
  })

  it('содержимое секции монтируется лениво — только дойдя до экрана', () => {
    const section = source('src/components/messenger/PanelSection.vue')
    expect(section).toContain('useVisibleOnce(')
    // Рисуем, когда секция дошла до экрана; исключение — `force`, по нему лента
    // заранее показывает секции до цели, чтобы посчитать высоту для перехода.
    expect(section).toContain('v-if="visible || force"')
    // По этому атрибуту лента находит секцию и прокручивает к ней.
    expect(section).toContain(':data-section="sectionKey"')
  })
})
