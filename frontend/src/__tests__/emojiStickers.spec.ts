import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  emojiCount,
  emojiLayout,
  EMOJI_STICKER_MAX,
  isEmojiOnly,
  readRecentStickers,
  rememberSticker,
  STICKER_RECENT_KEY,
  STICKER_RECENT_LIMIT
} from '@/utils/emoji'

/**
 * Стикеры как крупные эмодзи.
 *
 * Правило простое, но ошибка в нём заметна сразу: «привет 🙂» не должно
 * превращаться в стикер, а флаг или семья (несколько кодовых точек) должны
 * считаться ОДНИМ эмодзи — иначе три 🇷🇺 подряд не помещались бы в строку.
 */

describe('сколько эмодзи в тексте', () => {
  it('считает обычные эмодзи', () => {
    expect(emojiCount('🙂')).toBe(1)
    expect(emojiCount('🙂🙂')).toBe(2)
    expect(emojiCount('🙂 🙂')).toBe(2)
  })

  it('флаг — один эмодзи, а не два', () => {
    expect(emojiCount('🇷🇺')).toBe(1)
  })

  it('семья со ZWJ — один эмодзи', () => {
    expect(emojiCount('👨‍👩‍👧')).toBe(1)
  })

  it('скин-тон и вариационный селектор не добавляют эмодзи', () => {
    expect(emojiCount('👍🏽')).toBe(1)
    expect(emojiCount('❤️')).toBe(1)
  })

  it('keycap — один эмодзи', () => {
    expect(emojiCount('1️⃣')).toBe(1)
  })

  it('в обычном тексте эмодзи не считается', () => {
    expect(emojiCount('привет')).toBe(0)
  })
})

describe('сообщение только из эмодзи', () => {
  it('эмодзи со пробелами — да', () => {
    expect(isEmojiOnly('🙂')).toBe(true)
    expect(isEmojiOnly('  🙂  ')).toBe(true)
    expect(isEmojiOnly('🙂\n🙂')).toBe(true)
  })

  it('буквы, цифры и знаки — нет', () => {
    expect(isEmojiOnly('привет')).toBe(false)
    expect(isEmojiOnly('привет 🙂')).toBe(false)
    expect(isEmojiOnly('🙂!')).toBe(false)
    expect(isEmojiOnly('1')).toBe(false)
    expect(isEmojiOnly('')).toBe(false)
  })
})

describe('как рисовать сообщение', () => {
  it('1–2 эмодзи — очень крупно, 3 — крупно, больше — обычным текстом', () => {
    expect(emojiLayout('🙂')).toBe('huge')
    expect(emojiLayout('🙂🙂')).toBe('huge')
    expect(emojiLayout('🙂🙂🙂')).toBe('large')
    expect(emojiLayout('🙂'.repeat(EMOJI_STICKER_MAX + 1))).toBe('text')
  })

  it('флаг и семья — тоже стикер', () => {
    expect(emojiLayout('🇷🇺')).toBe('huge')
    expect(emojiLayout('👨‍👩‍👧 👩‍💻')).toBe('huge')
  })

  it('текст с эмодзи остаётся текстом', () => {
    expect(emojiLayout('привет 🙂')).toBe('text')
    expect(emojiLayout('')).toBe('text')
  })
})

describe('недавние стикеры', () => {
  const storage = (value: string | null): Storage =>
    ({
      getItem: (key: string) => (key === STICKER_RECENT_KEY ? value : null)
    }) as Storage

  it('читает список, отбрасывая мусор', () => {
    expect(readRecentStickers(storage(JSON.stringify(['🙂', 42, 'привет', '🔥'])))).toEqual([
      '🙂',
      '🔥'
    ])
  })

  it('битое значение не ломает ввод', () => {
    expect(readRecentStickers(storage('{oops'))).toEqual([])
    expect(readRecentStickers(undefined)).toEqual([])
  })

  it('недавний стикер встаёт в начало, без дублей и не длиннее лимита', () => {
    expect(rememberSticker(['🙂', '🔥'], '🔥')).toEqual(['🔥', '🙂'])
    const many = Array.from({ length: STICKER_RECENT_LIMIT }, (_, i) =>
      String.fromCodePoint(0x1f600 + i)
    )
    expect(rememberSticker(many, '🎉')).toHaveLength(STICKER_RECENT_LIMIT)
  })
})

describe('связки в интерфейсе', () => {
  const composer = readFileSync('src/components/messenger/MessageComposer.vue', 'utf8')
  const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
  const messenger = readFileSync('src/views/Messenger.vue', 'utf8')

  it('в меню доп. контента есть вкладка «Стикеры»', () => {
    expect(composer).toContain("emit('set-extras-tab', 'stickers')")
    expect(composer).toContain('stickers-panel')
    expect(composer).toContain('Стикер уходит сразу')
  })

  it('тап по стикеру отправляет сообщение, а не вставляет символ', () => {
    expect(composer).toContain("emit('send-sticker', sticker)")
    expect(composer).toContain('STICKER_RECENT_KEY')
    expect(messenger).toContain('@send-sticker="sendSticker"')
    // Стикер — отдельное сообщение: набранный текст в поле остаётся.
    const handler = messenger.slice(
      messenger.indexOf('const sendSticker'),
      messenger.indexOf('const appendMessage')
    )
    expect(handler).toContain('deliverText(chatId, sticker')
    expect(handler).not.toContain('newMessage.value = ')
  })

  it('в ленте стикер рисуется крупно и без пузыря', () => {
    expect(row).toContain("import { emojiLayout, type EmojiLayout } from '@/utils/emoji'")
    expect(row).toContain("'sticker-only': stickerLayout !== 'text'")
    expect(row).toContain('class="msg-sticker"')
    expect(row).toContain('.msg-bubble.sticker-only')
  })

  it('у пузыря картинки-стикера нет предела ширины в процентах', () => {
    // Ширина строки со вложением считается по содержимому, то есть по самому
    // пузырю: `max-width: min(70%, 320px)` разрешалось в его же ширину, пузырь
    // сжимался до 115px при картинке 160px и обрезал её справа на 47px
    // (проверено на живом приложении 20.09.2026). У эмодзи-стикера (текст
    // переносится) процент безобиден, у картинки — нет.
    const block = row.slice(row.indexOf('.msg-bubble.sticker-image'))
    const rule = block.slice(block.indexOf('{'), block.indexOf('}'))
    expect(rule).toContain('max-width: 320px')
    expect(rule).not.toContain('%')
  })

  it('стикером не становится сообщение с вложением, ответом или пересылкой', () => {
    const computed = row.slice(row.indexOf('const stickerLayout'))
    expect(computed).toContain('message.file')
    expect(computed).toContain('message.forwarded_from')
    expect(computed).toContain('props.quote')
    expect(computed).toContain("if (props.selectionMode && props.selected) return 'text'")
  })
})
