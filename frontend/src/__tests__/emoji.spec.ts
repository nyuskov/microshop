import { beforeEach, describe, expect, it } from 'vitest'

import { EMOJI_RECENT_KEY, EMOJI_RECENT_LIMIT, readRecentEmoji, rememberEmoji } from '@/utils/emoji'

/** «Недавние» эмодзи: без них нужный смайл приходится искать глазами. */

describe('недавние эмодзи', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('пустое хранилище — пустой список', () => {
    expect(readRecentEmoji(localStorage)).toEqual([])
  })

  it('новый эмодзи встаёт в начало без дублей', () => {
    expect(rememberEmoji(['😀', '🔥'], '🔥')).toEqual(['🔥', '😀'])
    expect(rememberEmoji(['😀'], '🎉')).toEqual(['🎉', '😀'])
  })

  it('список не длиннее лимита', () => {
    const many = Array.from({ length: EMOJI_RECENT_LIMIT }, (_, i) => `e${i}`)
    const result = rememberEmoji(many, 'новый')
    expect(result).toHaveLength(EMOJI_RECENT_LIMIT)
    expect(result[0]).toBe('новый')
  })

  it('битое значение в localStorage не ломает панель', () => {
    localStorage.setItem(EMOJI_RECENT_KEY, '{не json')
    expect(readRecentEmoji(localStorage)).toEqual([])
    localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify({ a: 1 }))
    expect(readRecentEmoji(localStorage)).toEqual([])
    localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify(['😀', 5, null]))
    expect(readRecentEmoji(localStorage)).toEqual(['😀'])
  })
})
