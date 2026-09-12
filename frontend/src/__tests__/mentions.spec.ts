import { describe, expect, it } from 'vitest'
import {
  applyMention,
  mentionBeforeCaret,
  plainMessageText,
  splitMessageText
} from '@/utils/mentions'

describe('splitMessageText', () => {
  it('разбивает текст на обычные куски и упоминания', () => {
    expect(splitMessageText('привет @ivan, как дела?')).toEqual([
      { type: 'text', value: 'привет ' },
      { type: 'mention', value: '@ivan' },
      { type: 'text', value: ', как дела?' }
    ])
  })

  it('находит несколько упоминаний и текст без них', () => {
    expect(splitMessageText('@a1 @b2')).toEqual([
      { type: 'mention', value: '@a1' },
      { type: 'text', value: ' ' },
      { type: 'mention', value: '@b2' }
    ])
    expect(splitMessageText('обычный текст')).toEqual([{ type: 'text', value: 'обычный текст' }])
  })

  it('слишком короткий логин упоминанием не считается', () => {
    expect(splitMessageText('@a')).toEqual([{ type: 'text', value: '@a' }])
  })

  it('пустая строка даёт пустой список', () => {
    expect(splitMessageText('')).toEqual([])
  })

  it('выделяет ссылку отдельным фрагментом', () => {
    expect(splitMessageText('смотри https://habr.com/ru/feed/ — полезно')).toEqual([
      { type: 'text', value: 'смотри ' },
      { type: 'link', value: 'https://habr.com/ru/feed/', href: 'https://habr.com/ru/feed/' },
      { type: 'text', value: ' — полезно' }
    ])
  })

  it('внутри ссылки упоминание не ищем', () => {
    expect(splitMessageText('https://t.me/@durov')).toEqual([
      { type: 'link', value: 'https://t.me/@durov', href: 'https://t.me/@durov' }
    ])
  })
})

describe('оформление текста', () => {
  it('разбирает жирный, курсив, код, зачёркнутый и спойлер', () => {
    expect(splitMessageText('это *жирный* и _курсив_, `код`, ~~нет~~, ||секрет||')).toEqual([
      { type: 'text', value: 'это ' },
      { type: 'bold', value: 'жирный' },
      { type: 'text', value: ' и ' },
      { type: 'italic', value: 'курсив' },
      { type: 'text', value: ', ' },
      { type: 'code', value: 'код' },
      { type: 'text', value: ', ' },
      { type: 'strike', value: 'нет' },
      { type: 'text', value: ', ' },
      { type: 'spoiler', value: 'секрет' }
    ])
  })

  it('двойные звёздочки и подчёркивания тоже работают', () => {
    expect(splitMessageText('**важно** и __тоже__')).toEqual([
      { type: 'bold', value: 'важно' },
      { type: 'text', value: ' и ' },
      { type: 'italic', value: 'тоже' }
    ])
  })

  it('умножение звёздочкой текстом остаётся', () => {
    expect(splitMessageText('2 * 3 * 4')).toEqual([{ type: 'text', value: '2 * 3 * 4' }])
  })

  it('подчёркивания внутри слова не превращают его в курсив', () => {
    expect(splitMessageText('проверь snake_case_name')).toEqual([
      { type: 'text', value: 'проверь snake_case_name' }
    ])
  })

  it('незакрытая разметка остаётся текстом', () => {
    expect(splitMessageText('*жирный и `код')).toEqual([{ type: 'text', value: '*жирный и `код' }])
  })

  it('оформление не разбирается внутри ссылки', () => {
    expect(splitMessageText('https://x.ru/a*b*c')).toEqual([
      { type: 'link', value: 'https://x.ru/a*b*c', href: 'https://x.ru/a*b*c' }
    ])
  })

  it('упоминание и оформление в одном сообщении не мешают друг другу', () => {
    expect(splitMessageText('@ivan смотри *важное*')).toEqual([
      { type: 'mention', value: '@ivan' },
      { type: 'text', value: ' смотри ' },
      { type: 'bold', value: 'важное' }
    ])
  })
})

describe('plainMessageText', () => {
  it('отдаёт текст без служебных символов — для превью и цитат', () => {
    expect(plainMessageText('это *жирный* и `код`')).toBe('это жирный и код')
    expect(plainMessageText('обычный текст')).toBe('обычный текст')
    expect(plainMessageText('')).toBe('')
  })

  it('ссылки и упоминания остаются на месте', () => {
    expect(plainMessageText('@ivan вот https://pismo.space/a*b')).toBe(
      '@ivan вот https://pismo.space/a*b'
    )
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
