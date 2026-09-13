import { beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '@/types'
import {
  DEFAULT_QUICK_REACTION,
  QUICK_REACTIONS,
  REACTION_EMOJIS,
  hasMyReaction,
  lastQuickReaction,
  rememberQuickReaction
} from '@/utils/reactions'

/**
 * Реакции: подсветка «моей» реакции и реакция для двойного тапа.
 * Логика вынесена из разметки `MessageRow`, поэтому проверяется без DOM.
 */
const messageWith = (reactions: { emoji: string; count: number; reacted_by_me: boolean }[]) =>
  ({ id: 1, reactions }) as unknown as Message

beforeEach(() => {
  localStorage.clear()
})

describe('hasMyReaction', () => {
  it('находит мою реакцию', () => {
    const message = messageWith([
      { emoji: '👍', count: 2, reacted_by_me: false },
      { emoji: '🔥', count: 1, reacted_by_me: true }
    ])

    expect(hasMyReaction(message, '🔥')).toBe(true)
  })

  it('чужую реакцию моей не считает', () => {
    const message = messageWith([{ emoji: '👍', count: 3, reacted_by_me: false }])

    expect(hasMyReaction(message, '👍')).toBe(false)
  })

  it('на сообщении без реакций — false', () => {
    expect(hasMyReaction(messageWith([]), '👍')).toBe(false)
  })
})

describe('быстрая реакция (двойной тап)', () => {
  it('по умолчанию — сердце', () => {
    expect(lastQuickReaction()).toBe(DEFAULT_QUICK_REACTION)
  })

  it('запоминает выбранную вручную реакцию', () => {
    rememberQuickReaction('🎉')

    expect(lastQuickReaction()).toBe('🎉')
  })
})

describe('наборы эмодзи', () => {
  it('быстрые реакции входят в полный набор', () => {
    for (const emoji of QUICK_REACTIONS) {
      expect(REACTION_EMOJIS).toContain(emoji)
    }
  })

  it('в наборах нет повторов', () => {
    expect(new Set(REACTION_EMOJIS).size).toBe(REACTION_EMOJIS.length)
    expect(new Set(QUICK_REACTIONS).size).toBe(QUICK_REACTIONS.length)
  })
})
