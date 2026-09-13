import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { useSlideDown } from '@/composables/useSlideDown'

/**
 * Плавное раскрытие панелей (поиск и полоса историй) «слайдом вниз».
 *
 * jsdom не считает раскладку, поэтому высоту задаём сами, а записи в стиль
 * ловим подменённым `style` — так видно, с какой высоты начинается и на какой
 * заканчивается анимация (это и есть весь смысл хуков).
 */

const hooks = useSlideDown()

interface Fixture {
  el: HTMLElement
  writes: string[]
  /** Меняет «видимую» высоту — например, панель закрывают недорисованной. */
  resize: (height: number) => void
}

const setup = (height: number): Fixture => {
  const el = document.createElement('div')
  let measured = height
  el.getBoundingClientRect = () => ({ height: measured }) as DOMRect
  const writes: string[] = []
  const style = {
    set height(value: string) {
      writes.push(`height:${value || '-'}`)
    },
    get height() {
      return ''
    },
    set opacity(value: string) {
      writes.push(`opacity:${value || '-'}`)
    },
    get opacity() {
      return ''
    }
  }
  Object.defineProperty(el, 'style', { configurable: true, value: style })
  return { el, writes, resize: (next) => (measured = next) }
}

const lastWrite = (writes: string[], property: 'height' | 'opacity') =>
  [...writes].reverse().find((entry) => entry.startsWith(`${property}:`))

describe('раскрытие слайдом вниз', () => {
  it('стартует со свернутого состояния', () => {
    const { el, writes } = setup(96)

    hooks.onBeforeEnter?.(el)

    expect(writes).toEqual(['height:0px', 'opacity:0'])
  })

  it('на входе раскрывается до измеренной высоты содержимого', () => {
    const { el, writes } = setup(96)

    hooks.onBeforeEnter?.(el)
    hooks.onEnter?.(el)

    // auto — измеряем, 0px — старт анимации, 96px — цель.
    expect(writes).toEqual([
      'height:0px',
      'opacity:0',
      'height:auto',
      'height:0px',
      'height:96px',
      'opacity:1'
    ])
  })

  it('после входа отдаёт высоту обратно вёрстке', () => {
    const { el, writes } = setup(96)

    hooks.onBeforeEnter?.(el)
    hooks.onEnter?.(el)
    hooks.onAfterEnter?.(el)

    expect(lastWrite(writes, 'height')).toBe('height:-')
    expect(lastWrite(writes, 'opacity')).toBe('opacity:-')
  })

  it('на выходе закрывается с текущей высоты', () => {
    const { el, writes } = setup(96)

    hooks.onLeave?.(el)

    // Первая запись — старт (та же высота), последняя — свёрнутое состояние.
    expect(writes[0]).toBe('height:96px')
    expect(lastWrite(writes, 'height')).toBe('height:0px')
    expect(lastWrite(writes, 'opacity')).toBe('opacity:0')
  })

  it('быстрое закрытие недорисованной панели стартует с видимой высоты', () => {
    const { el, writes, resize } = setup(96)

    hooks.onBeforeEnter?.(el)
    hooks.onEnter?.(el)
    resize(30)
    writes.length = 0
    hooks.onLeave?.(el)

    expect(writes[0]).toBe('height:30px')
    expect(lastWrite(writes, 'height')).toBe('height:0px')
  })

  it('после выхода высота снова у вёрстки, а не 0px', () => {
    const { el, writes } = setup(96)

    hooks.onLeave?.(el)
    hooks.onAfterLeave?.(el)

    expect(lastWrite(writes, 'height')).toBe('height:-')
  })

  it('у всех хуков ровно один параметр: иначе Vue ждёт done и элемент не уберётся', () => {
    const arity = (hook: unknown) => (hook as () => void).length

    expect(arity(hooks.onBeforeEnter)).toBe(1)
    expect(arity(hooks.onEnter)).toBe(1)
    expect(arity(hooks.onAfterEnter)).toBe(1)
    expect(arity(hooks.onLeave)).toBe(1)
    expect(arity(hooks.onAfterLeave)).toBe(1)
  })
})

describe('панели списка чатов', () => {
  const sidebar = readFileSync('src/components/messenger/ChatSidebar.vue', 'utf8')
  const header = readFileSync('src/components/messenger/SidebarHeader.vue', 'utf8')

  it('поиск и истории раскрываются переходами на общих хуках', () => {
    // Поиск — обычный слайд, истории — усиленный (они раскрываются вторым шагом).
    expect(sidebar.match(/name="slide-down"/g)).toHaveLength(1)
    expect(sidebar.match(/name="slide-strong"/g)).toHaveLength(1)
    expect(sidebar).toContain('v-bind="slideDown"')
    expect(sidebar).toContain('v-bind="slideDownStories"')
    expect(sidebar).toContain("import { useSlideDown } from '@/composables/useSlideDown'")
  })

  it('полоса историй стоит выше поля поиска, как в Telegram', () => {
    // Раскрытые истории находятся НАД открытым поиском: в разметке полоса
    // историй идёт раньше поля поиска.
    const storiesAt = sidebar.indexOf('class="stories-collapse"')
    const searchAt = sidebar.indexOf('class="search-collapse"')

    expect(storiesAt).toBeGreaterThan(-1)
    expect(searchAt).toBeGreaterThan(-1)
    expect(storiesAt).toBeLessThan(searchAt)
  })

  it('панели раскрываются по шагам: поиск первым, истории — сильнее', () => {
    expect(sidebar).toContain('PULL_STORIES_PX')
    // Сравниваем пороги: для историй нужно протянуть дальше.
    const search = Number(sidebar.match(/PULL_EXPAND_PX = (\d+)/)?.[1] ?? '0')
    const stories = Number(sidebar.match(/PULL_STORIES_PX = (\d+)/)?.[1] ?? '0')

    expect(stories).toBeGreaterThan(search)
    // За одно касание делаем только один шаг, иначе истории раскрывались бы сразу.
    expect(sidebar).toContain('pullUsed = true')
  })

  it('переходы через max-height не вернулись', () => {
    expect(sidebar).not.toContain('search-expand')
    expect(sidebar).not.toContain('stories-drop')
  })

  it('список чатов остаётся на месте, пока запрос поиска пуст', () => {
    // Список подменяют только результаты поиска — и только когда он что-то ищет:
    // SearchResults идёт с v-if, а список чатов — в v-else той же цепочки.
    expect(sidebar).toContain('v-if="searchActive"')
    const resultsAt = sidebar.indexOf('<SearchResults')
    const listAt = sidebar.indexOf('<ChatList')
    expect(resultsAt).toBeGreaterThan(-1)
    expect(listAt).toBeGreaterThan(resultsAt)
    expect(sidebar.slice(resultsAt, listAt)).toContain('v-else')
    // Раньше при открытом поиске прятался и список: `v-else-if="!searchOpen"`.
    expect(sidebar).not.toContain('v-else-if="!searchOpen"')
    expect(sidebar).not.toContain('searchOpen && searchQuery.trim()')
  })

  it('фильтр чипов не зависит от запроса поиска', () => {
    // Запрос уходит на сервер (поиск людей и сообщений), а не фильтрует список:
    // локальная фильтрация по нему была мертва — список виден только с пустым.
    expect(sidebar).not.toContain('searchQuery.value.trim().toLowerCase()')
  })

  it('фокус в поле поиска не дёргает прокрутку списка', () => {
    expect(sidebar).toContain('focus({ preventScroll: true })')
  })

  it('панель открывается и закрывается значком в шапке, стрелки «назад» нет', () => {
    expect(sidebar).toContain('@toggle-search="toggleSearch"')
    expect(header).toContain('@click="emit(\'toggle-search\')"')
    expect(sidebar).not.toContain('search-back')
    expect(header).not.toContain('search-back')
  })

  it('протяжка списка вниз раскрывает и поиск, и истории', () => {
    const pull = sidebar.slice(sidebar.indexOf('const onListTouchMove'))
    const body = pull.slice(0, pull.indexOf('\n}'))
    expect(body).toContain('setStoriesExpanded(true)')
    expect(body).toContain('revealSearch()')
    // Протяжка не должна забирать фокус: клавиатура на жест не выезжает.
    expect(body).not.toContain('openSearch()')
  })

  it('прокрутка списка вверх сжимает обе панели', () => {
    const scroll = sidebar.slice(sidebar.indexOf('const onChatsScroll'))
    const body = scroll.slice(0, scroll.indexOf('const PULL_EXPAND_PX'))
    expect(body).toContain('setStoriesExpanded(false)')
    expect(body).toContain('closeSearch()')
  })

  it('содержимое панелей едет от шапки вниз и обратно вверх', () => {
    expect(sidebar).toContain('transform: translateY(-100%)')
  })
})
