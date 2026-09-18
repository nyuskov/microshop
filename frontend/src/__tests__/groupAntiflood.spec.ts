import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Анти-флуд в группе: мут, бан и медленный режим (F10).
 *
 * Цепочка длинная — сервис → карточка группы → права, — и рвётся незаметно:
 * кнопка без вызова сервиса, ответ сервера без обновления списка или мут,
 * который показывается «действующим» после истечения срока. Проверки
 * статические (карточка группы тянет контакты и запросы, в jsdom это шум), а
 * поведение эндпоинтов проверяют бэкенд-тесты `tests/test_group_antiflood.py`.
 */
const info = readFileSync('src/components/messenger/GroupChatInfo.vue', 'utf8')
const service = readFileSync('src/services/chatService.ts', 'utf8')
const types = readFileSync('src/types/index.ts', 'utf8')

describe('сервис анти-флуда', () => {
  it('мут, бан и медленный режим ходят в свои эндпоинты', () => {
    expect(service).toContain('/members/${userId}/mute/')
    expect(service).toContain('/members/${userId}/ban/')
    expect(service).toContain('/bans/${userId}/')
    expect(service).toContain('`/chats/${chatId}/bans/`')
    expect(service).toContain('/slow-mode/')
  })

  it('мут и бан возвращают карточку группы: список обновляется без запроса', () => {
    const mute = service.slice(service.indexOf('export const muteGroupMember'))
    expect(mute.slice(0, 400)).toContain('Promise<ChatDetail>')
    const ban = service.slice(service.indexOf('export const banGroupMember'))
    expect(ban.slice(0, 400)).toContain('Promise<ChatDetail>')
  })

  it('типы знают про мут участника, бан-лист и медленный режим', () => {
    expect(types).toContain('muted_until?: string | null')
    expect(types).toContain('interface ChatBanEntry')
    expect(types).toContain('slow_mode_seconds?: number')
  })
})

describe('карточка группы', () => {
  it('в меню участника есть «Замутить» и «Забанить», в мутe — «Снять мут»', () => {
    expect(info).toContain("title: 'Замутить'")
    expect(info).toContain("title: 'Снять мут'")
    expect(info).toContain("title: 'Забанить'")
    // Действия — там же, где исключение: обычно это одно решение.
    const actions = info.slice(info.indexOf('const memberActions'))
    expect(actions).toContain("key: 'ban'")
    expect(actions).toContain("key: 'mute'")
  })

  it('длительность мута выбирается пресетами', () => {
    expect(info).toContain('MUTE_OPTIONS')
    expect(info).toContain('7 дней')
    expect(info).toContain('applyMute(option.minutes)')
    // Снятие мута — отдельной кнопкой в той же панели.
    expect(info).toContain('@click="applyMute(null)"')
  })

  it('забаненных видно и можно разбанить', () => {
    expect(info).toContain('fetchGroupBans')
    expect(info).toContain('Разбанить')
    expect(info).toContain('unbanGroupMember')
    // Список грузится вместе с карточкой у тех, кто им управляет.
    const load = info.slice(info.indexOf('const load = async'))
    expect(load.slice(0, 600)).toContain('loadBans()')
  })

  it('медленный режим настраивается из карточки', () => {
    expect(info).toContain('SLOW_MODE_OPTIONS')
    expect(info).toContain('Медленный режим')
    expect(info).toContain('applySlowMode(option.seconds)')
    expect(info).toContain('setGroupSlowMode')
  })

  it('истёкший мут не показывается как действующий', () => {
    const muted = info.slice(info.indexOf('const isMuted'))
    expect(muted.slice(0, 300)).toContain('muted_until')
    expect(muted.slice(0, 300)).toContain('> Date.now()')
  })

  it('после бана ключ группы выпускается заново (исключённый не должен читать)', () => {
    const ban = info.slice(info.indexOf('const applyBan'))
    expect(ban.slice(0, 900)).toContain("emit('members-changed', true)")
    expect(ban.slice(0, 900)).toContain("emit('updated')")
  })

  it('панели анти-флуда закрываются при смене чата', () => {
    const watcher = info.slice(info.indexOf('() => props.chat.id'))
    expect(watcher.slice(0, 400)).toContain('muteTarget.value = null')
    expect(watcher.slice(0, 400)).toContain('slowPanelOpen.value = false')
  })
})
