/**
 * Стражи слоя оформления: выделение текста, общий слой всплывающих панелей,
 * AMOLED-тени и ступени геометрии.
 *
 * Проверки читают исходники: «выдели текст и посмотри цвет» и «подсвети панель
 * поверх ленты» в юнит-тесте не поднять, а сломать легко — например, вернув
 * меню собственную подложку и тень (тогда общий слой молча обойдён, и панели
 * снова разъедутся).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

const css = source('src/assets/appearance.css')
const actions = source('src/components/messenger/MessageActionsBar.vue')
const chatHeader = source('src/components/messenger/ChatHeader.vue')
const sidebarHeader = source('src/components/messenger/SidebarHeader.vue')
const composer = source('src/components/messenger/MessageComposer.vue')

describe('выделение текста', () => {
  it('подсветка — из акцента, а не системная', () => {
    expect(css).toMatch(/::selection\s*\{\s*background:\s*color-mix\(in srgb, var\(--ms-accent\)/)
  })

  it('цвет текста не фиксируем: он свой на пузыре, в поле ввода и в тёмной теме', () => {
    const rule = css.slice(css.indexOf('::selection'))
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('color:')
  })
})

describe('общий слой всплывающих панелей', () => {
  it('подложка, рамка и тень собраны в одном месте', () => {
    expect(css).toMatch(/\.ms-pop\s*\{[^}]*background:\s*var\(--ms-surface\)/)
    expect(css).toMatch(/\.ms-pop\s*\{[^}]*border:\s*1px solid var\(--ms-border\)/)
    expect(css).toMatch(/\.ms-pop\s*\{[^}]*box-shadow:\s*var\(--ms-shadow-pop\)/)
    // Радиус — токен набора темы (проверка токенов иначе ругается на имя без
    // объявления), поэтому он обязан быть в `appearance.css`.
    expect(css).toContain('--ms-pop-radius: var(--ms-radius-md);')
  })

  it('меню и палитры пользуются слоем, а не своими копиями', () => {
    expect(actions).toContain('class="more-menu ms-pop"')
    expect(actions).toContain('class="emoji-picker ms-pop"')
    expect(chatHeader).toContain('class="ms-dropdown ms-pop"')
    expect(sidebarHeader).toContain('class="ms-dropdown ms-pop"')
    expect(composer).toContain('class="mention-panel ms-pop"')
    // Своей подложки у палитры больше нет — иначе она обошла бы слой.
    expect(actions).not.toContain('border-radius: 14px;')
  })

  it('широким меню оставлен крупный радиус', () => {
    expect(chatHeader).toContain('--ms-pop-radius: var(--ms-radius-lg);')
    expect(sidebarHeader).toContain('--ms-pop-radius: var(--ms-radius-lg);')
  })
})

describe('AMOLED: обводка вместо тени', () => {
  it('тени заменены тонкой линией — на чистом чёрном их не видно', () => {
    const amoled = css.slice(css.indexOf("html[data-theme='amoled'] {"))
    for (const token of ['sm', 'md', 'pop', 'float']) {
      expect(amoled).toContain(`--ms-shadow-${token}: 0 0 0 1px var(--ms-hairline);`)
    }
  })
})

describe('геометрия панелей — ступени шкалы, не «на глаз»', () => {
  it('в панелях чата и диалогах каналов литеральных радиусов нет', () => {
    const files = [
      'src/components/messenger/ChatInfo.vue',
      'src/components/messenger/GroupChatInfo.vue',
      'src/components/channels/ChannelInfoDialog.vue',
      'src/components/channels/ChannelCreateDialog.vue',
      'src/components/channels/ChannelJoinDialog.vue'
    ]
    for (const file of files) {
      // `999px` (таблетка) — не ступень, литералом допустим (см. check-geometry).
      const literals = source(file).match(/border-radius: (?!999px)\d+px/g) ?? []
      expect(literals, file).toEqual([])
    }
  })
})
