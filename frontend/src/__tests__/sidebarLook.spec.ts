import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Вид шапки панели чатов и строк списка.
 *
 * Правки «на вид», но у каждой — измеренная причина (390×844, тёмная тема):
 * шапка была рядом иконок с неравным вертикальным отступом (8 сверху / 4 снизу),
 * круг профиля 40px перетягивал внимание на себя, чипы фильтров стояли с
 * четырьмя пикселями воздуха по бокам («слипшиеся» подписи), а непрочитанный чат
 * отличался от прочитанного только счётчиком справа.
 *
 * jsdom не считает ни раскладку, ни видимость, поэтому читаем исходники.
 */
const SRC = path.resolve(import.meta.dirname, '..')
const source = (relative: string): string => readFileSync(path.join(SRC, relative), 'utf8')

const header = source('components/messenger/SidebarHeader.vue')
const list = source('components/messenger/ChatList.vue')
const rows = source('assets/rows.css')

/** Тело CSS-правила по селектору (первое совпадение). */
const ruleOf = (css: string, selector: string): string => {
  const from = css.indexOf(`${selector} {`)
  expect(from, `нет правила ${selector}`).toBeGreaterThan(-1)
  return css.slice(from, css.indexOf('}', from))
}

describe('шапка панели чатов', () => {
  it('вертикальные отступы равные — ряд не липнет к фильтрам', () => {
    const rule = ruleOf(header, '.panel-header')

    expect(rule).toContain('padding: var(--ms-space-2) var(--ms-space-3)')
    expect(rule).toContain('align-items: center')
  })

  it('круг профиля меньше кнопок и с тонкой обводкой', () => {
    const button = ruleOf(header, '.self-profile-btn')
    const avatar = ruleOf(header, '.self-profile-btn .self-avatar')

    expect(button).toContain('width: 36px')
    expect(button).toContain('height: 36px')
    expect(avatar).toContain('width: 36px')
    expect(avatar).toContain('height: 36px')
    expect(avatar).toContain('box-shadow: 0 0 0 1px var(--ms-hairline)')
    // Круг отделён от кнопок небольшим отступом — группа иконок читается целиком.
    expect(button).toContain('margin-left: var(--ms-space-1)')
  })
})

describe('ряд фильтров', () => {
  it('чипы-таблетки с воздухом внутри подписи', () => {
    const chip = ruleOf(list, '.chat-filter')

    expect(chip).toContain('border-radius: var(--ms-radius-pill)')
    expect(chip).toContain('padding: 6px 11px')
    // Наведение — своё состояние: без него чип «не отвечает» на курсор.
    expect(list).toContain('.chat-filter:hover {')
  })

  it('кнопка «новая папка» — спокойный чип, без пунктирной рамки', () => {
    const add = ruleOf(list, '.chat-filter-add')

    expect(add).not.toContain('dashed')
    expect(add).toContain('background: transparent')
  })

  it('затухание краёв достаточно широкое: обрезанный чип не читается как поломка', () => {
    expect(list).toContain(
      'mask-image: linear-gradient(to right, black calc(100% - 16px), transparent)'
    )
    expect(list).toContain('mask-image: linear-gradient(to right, transparent, black 16px)')
  })
})

describe('строка списка', () => {
  it('непрочитанный чат отличается не только счётчиком', () => {
    // Класс ставится по числу непрочитанных, стили — в общем слое строк.
    expect(list).toContain('unread: chat.unread_count > 0')
    expect(rows).toContain('.ms-rows .row-item.unread .row-title')
    expect(ruleOf(rows, '.ms-rows .row-item.unread .row-title')).toContain('font-weight: 700')
    expect(ruleOf(rows, '.ms-rows .row-item.unread .row-sub')).toContain('font-weight: 500')
    // «Печатает…» и черновик со своим акцентным цветом не перекрываем.
    expect(rows).toContain('.ms-rows .row-item.unread .row-sub:not(.typing):not(.draft)')
  })
})
