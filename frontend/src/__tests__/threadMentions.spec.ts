import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { DRAWN_GLYPHS, ICON_MAP } from '@/utils/icons'

/**
 * Переход по упоминаниям меня в группе или канале.
 *
 * Отдельного механизма не заводим: поиск по сообщениям уже умеет искать по всей
 * истории НА СЕРВЕРЕ (`useThreadSearch` → `searchMessages`) и догружать старые
 * страницы до совпадения. Пункт меню «Упоминания меня» открывает тот же поиск с
 * готовым запросом `@логин`.
 */
const header = readFileSync('src/components/messenger/ChatHeader.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
const drawnCss = readFileSync('src/assets/icons-drawn.css', 'utf8')

describe('упоминания меня: пункт меню и запрос', () => {
  it('пункт есть в меню «⋯» рядом с поиском и только когда есть логин', () => {
    expect(header).toContain('v-if="mentionLogin"')
    expect(header).toContain("runChatAction('mentions')")
    expect(header).toContain("if (action === 'mentions') emit('open-mentions')")
    expect(header).toContain("t('Упоминания меня')")
  })

  it('логин берём только для группы и канала', () => {
    // В личном диалоге и «Сохранённых» упоминать некого: поиск по `@логин`
    // нашёл бы пустоту, а пункт обещал бы то, чего нет.
    const body = messenger.slice(messenger.indexOf('const mentionLogin'))
    expect(body).toContain('if (!chat.is_group && !chat.is_channel) return')
    expect(body).toContain('authStore.current_user?.username')
  })

  it('пункт открывает поиск с запросом «@логин»', () => {
    const body = messenger.slice(messenger.indexOf('const openMentionsSearch'))
    expect(body).toContain('inlineQuery.value = `@${login}`')
    expect(body).toContain('if (!inlineSearchOpen.value) toggleInlineSearch()')
    expect(messenger).toContain(':mention-login="mentionLogin"')
    expect(messenger).toContain('@open-mentions="openMentionsSearch"')
  })
})

describe('подсказка «@» в поле ввода', () => {
  it('список участников — только для группы, в личке пусто', () => {
    // Владелец: «нужно убрать через @ упоминание в личных чатах, я думал эта
    // функция упоминания из других чатов, а так она не нужна». В личном
    // диалоге подсказка предлагала ровно собеседника — того, с кем и так
    // переписываешься, поэтому список (и панель) там больше не открываются.
    const body = messenger.slice(messenger.indexOf('const mentionMembers'))
    expect(body).toContain('if (!chat || !isGroupChat(chat) || chat.is_channel) return []')
    expect(messenger).toContain(':mention-members="mentionMembers"')
  })
})

describe('значок «@» для пункта меню', () => {
  it('глифа нет в Lucide — он нарисован вручную, без пересборки шрифта', () => {
    expect(ICON_MAP.alternate_email).toBe('at-sign')
    expect(DRAWN_GLYPHS.has('at-sign')).toBe(true)
    expect(drawnCss).toContain('.icon-at-sign {')
    // Форма как у остальных рисованных глифов: маска из своего SVG, краска —
    // currentColor (её ставит `.icon-drawn`).
    expect(drawnCss).toContain('--icon-glyph: url("data:image/svg+xml,')
  })
})
