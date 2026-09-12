import { describe, expect, it } from 'vitest'

import { unreadSeenAtBottom } from '@/utils/thread'

/**
 * Отметки непрочитанного внутри чата.
 *
 * Симптом из жизни: человек прочитал чат (доскроллил до конца), а разделитель
 * «Непрочитанные сообщения» и отметки оставались — до перезагрузки страницы.
 * Теперь лента сообщает наверх, что непрочитанных больше нет: достаточно дойти
 * до низа.
 */
describe('unreadSeenAtBottom', () => {
  it('дочитал до конца при непрочитанных — отметки снимаем', () => {
    expect(unreadSeenAtBottom(0, 3)).toBe(true)
    expect(unreadSeenAtBottom(59, 1)).toBe(true)
  })

  it('не дочитал — отметки остаются', () => {
    expect(unreadSeenAtBottom(60, 3)).toBe(false)
    expect(unreadSeenAtBottom(400, 10)).toBe(false)
  })

  it('непрочитанных нет — снимать нечего', () => {
    expect(unreadSeenAtBottom(0, 0)).toBe(false)
  })
})
