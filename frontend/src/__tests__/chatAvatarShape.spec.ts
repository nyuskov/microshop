import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { chatAvatarRounded } from '@/utils/user'
import type { Chat } from '@/types'

/**
 * Форма аватара различает тип чата.
 *
 * Владелец: «форма аватара по типу». У группы и канала — скруглённый квадрат, у
 * личного чата — круг: у канала тип виден по рупору, а группу от личного чата
 * иначе видно только по названию и числу участников.
 *
 * Решение одно на весь интерфейс (`chatAvatarRounded`), потому что аватар чата
 * рисуется и в списке, и в шапке переписки, и в результатах поиска — форма не
 * должна зависеть от того, где человек смотрит.
 */
const SRC = path.resolve(import.meta.dirname, '..')
const source = (relative: string): string => readFileSync(path.join(SRC, relative), 'utf8')

const chat = (extra: Partial<Chat> = {}): Chat =>
  ({
    id: 1,
    name: 'Чат',
    is_group: false,
    is_self: false,
    is_channel: false,
    users: [],
    ...extra
  }) as unknown as Chat

describe('форма аватара по типу чата', () => {
  it('личный чат — круг, группа и канал — скруглённый квадрат', () => {
    expect(chatAvatarRounded(chat())).toBe(false)
    expect(chatAvatarRounded(chat({ is_group: true }))).toBe(true)
    expect(chatAvatarRounded(chat({ is_channel: true, is_group: true }))).toBe(true)
    // «Сохранённые сообщения» — чат с собой: остаётся круглым.
    expect(chatAvatarRounded(chat({ is_self: true }))).toBe(false)
  })

  it('группой считается и чат с тремя участниками без флага is_group', () => {
    // Так же, как в остальном интерфейсе (`isGroupChat`): сервер отдаёт is_group,
    // но чат на три участника — группа и без него.
    const three = chat({ users: [{ id: 1 }, { id: 2 }, { id: 3 }] as Chat['users'] })
    expect(chatAvatarRounded(three)).toBe(true)
  })
})

describe('класс и стиль на месте', () => {
  it('список чатов и шапка переписки ставят класс rounded', () => {
    expect(source('components/messenger/ChatList.vue')).toContain(
      ':class="{ rounded: chatAvatarRounded(chat) }"'
    )
    const header = source('components/messenger/ChatHeader.vue')
    expect(header).toContain(':class="{ rounded: chatAvatarRounded(props.chat) }"')
    expect(header).toContain('.avatar.rounded {')
    // Форма — из шкалы радиусов, а не литералом.
    expect(header).toContain('border-radius: var(--ms-radius-lg)')
  })

  it('каталог каналов в поиске тоже показывает квадрат', () => {
    expect(source('components/messenger/SearchResults.vue')).toContain(
      'class="avatar rounded" :style="avatarStyle(channel.title)"'
    )
  })

  it('общий слой списков знает про квадрат', () => {
    const rows = source('assets/rows.css')
    expect(rows).toContain('.ms-rows .avatar.rounded')
    expect(rows).toContain('border-radius: var(--ms-radius-lg)')
    // Круглым личным чатам правило не мешает: базовый радиус остаётся 50%.
    expect(rows).toMatch(/\.ms-rows \.avatar \{[^}]*border-radius: 50%;/)
  })
})
