import { describe, expect, it } from 'vitest'
import { applyMention, mentionBeforeCaret, splitMentions } from '@/utils/mentions'

describe('splitMentions', () => {
  it('разбивает текст на обычные куски и упоминания', () => {
    expect(splitMentions('привет @ivan, как дела?')).toEqual([
      { type: 'text', value: 'привет ' },
      { type: 'mention', value: '@ivan' },
      { type: 'text', value: ', как дела?' }
    ])
  })

  it('находит несколько упоминаний и текст без них', () => {
    expect(splitMentions('@a1 @b2')).toEqual([
      { type: 'mention', value: '@a1' },
      { type: 'text', value: ' ' },
      { type: 'mention', value: '@b2' }
    ])
    expect(splitMentions('обычный текст')).toEqual([{ type: 'text', value: 'обычный текст' }])
  })

  it('слишком короткий логин упоминанием не считается', () => {
    expect(splitMentions('@a')).toEqual([{ type: 'text', value: '@a' }])
  })

  it('пустая строка даёт пустой список', () => {
    expect(splitMentions('')).toEqual([])
  })
})

describe('mentionBeforeCaret', () => {
  it('возвращает запрос и позицию @ под курсором', () => {
    expect(mentionBeforeCaret('привет @iv', 10)).toEqual({ query: 'iv', start: 7 })
  })

  it('работает в начале строки', () => {
    expect(mentionBeforeCaret('@iv', 3)).toEqual({ query: 'iv', start: 0 })
  })

  it('не срабатывает внутри слова или перед пробелом', () => {
    expect(mentionBeforeCaret('почта@iv', 8)).toBeNull()
    expect(mentionBeforeCaret('привет @ iv', 11)).toBeNull()
    expect(mentionBeforeCaret('без собаки', 10)).toBeNull()
  })
})

describe('applyMention', () => {
  it('вставляет логин вместо набранного запроса и ставит курсор после пробела', () => {
    const result = applyMention('привет @iv', 7, 10, 'ivan')
    expect(result.text).toBe('привет @ivan ')
    expect(result.caret).toBe(13)
  })

  it('сохраняет текст после курсора', () => {
    const result = applyMention('@iv, привет', 0, 3, 'ivan')
    expect(result.text).toBe('@ivan , привет')
    expect(result.caret).toBe(6)
  })
})
