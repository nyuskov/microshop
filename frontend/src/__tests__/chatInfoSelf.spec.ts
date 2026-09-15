import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * «Сохранённые сообщения» — чат с собой: в карточке чата не должно быть
 * действий над «собеседником», которого нет.
 *
 * ГРАБЛЯ (нашёл пользователь 15.09.2026): `utils/user.ts::chatPeer` для чата с
 * собой отдаёт САМОГО человека (фоллбэк `chat.users[0]`), поэтому карточка
 * предлагала «В контакты» (переименовать себя же), а тумблер «Сквозное
 * шифрование» отправлял запрос, который сервер отклоняет — `chat.is_self` даёт
 * 400 в `api_v1/chats/crud.py::set_chat_e2ee`.
 *
 * Проверка статическая: jsdom не ходит в сеть, а `ChatInfo` медиа грузит сам —
 * поэтому следим за условиями в разметке, как в adminPanel.spec.ts.
 */
const source = readFileSync('src/components/messenger/ChatInfo.vue', 'utf8')

describe('ChatInfo: чат с собой («Сохранённые сообщения»)', () => {
  it('узнаёт чат с собой по признаку is_self', () => {
    expect(source).toMatch(/const isSelfChat = computed<boolean>\(\(\) => props\.chat\.is_self/)
  })

  it('не предлагает добавить себя в контакты и переименовать', () => {
    expect(source).toContain('v-if="peer && !isSelfChat"')
    expect(source).toMatch(/<ContactNameDialog v-if="peer && !isSelfChat"/)
  })

  it('не показывает переключатель сквозного шифрования (сервер отклоняет)', () => {
    // Обе секции — «Контакт» и «Сквозное шифрование» — закрыты одним условием.
    const sections = source.match(/v-if="peer && !isSelfChat" class="ci-section ci-e2ee"/g) ?? []
    expect(sections).toHaveLength(2)
  })
})
