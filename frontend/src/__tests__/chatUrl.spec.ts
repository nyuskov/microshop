import { describe, expect, it } from 'vitest'
import { chatIdFromUrl, chatUrlWith } from '@/utils/chatUrl'

describe('chatIdFromUrl', () => {
  it('читает id чата из параметров', () => {
    expect(chatIdFromUrl('?chat=15')).toBe(15)
  })

  it('работает вместе с другими параметрами', () => {
    expect(chatIdFromUrl('?call=abc&peer=3&chat=42')).toBe(42)
  })

  it('возвращает null, если параметра нет', () => {
    expect(chatIdFromUrl('')).toBeNull()
    expect(chatIdFromUrl('?call=abc&peer=3')).toBeNull()
  })

  it('возвращает null для мусора вместо id', () => {
    expect(chatIdFromUrl('?chat=abc')).toBeNull()
    expect(chatIdFromUrl('?chat=-3')).toBeNull()
    expect(chatIdFromUrl('?chat=0')).toBeNull()
    expect(chatIdFromUrl('?chat=1.5')).toBeNull()
  })
})

describe('chatUrlWith', () => {
  it('добавляет параметр чата', () => {
    expect(chatUrlWith('/', 15)).toBe('/?chat=15')
  })

  it('заменяет чат при переходе в другой', () => {
    expect(chatUrlWith('/?chat=15', 42)).toBe('/?chat=42')
  })

  it('убирает параметр при возврате в список', () => {
    expect(chatUrlWith('/?chat=15', null)).toBe('/')
  })

  it('сохраняет параметры запуска звонка (по ним возвращаемся в звонок)', () => {
    expect(chatUrlWith('/?call=abc&peer=3&action=focus', 15)).toBe(
      '/?call=abc&peer=3&action=focus&chat=15'
    )
    expect(chatUrlWith('/?call=abc&peer=3&chat=15', null)).toBe('/?call=abc&peer=3')
  })

  it('не держит в адресе одноразовую пометку «прочитано»', () => {
    expect(chatUrlWith('/?chat=15&markread=1', 15)).toBe('/?chat=15')
  })

  it('сохраняет переход по «#»-ссылке', () => {
    expect(chatUrlWith('/#top', 15)).toBe('/?chat=15#top')
  })

  it('результат читается обратно', () => {
    const url = chatUrlWith('/?chat=15', 42)
    expect(chatIdFromUrl(url.slice(url.indexOf('?')))).toBe(42)
  })
})
