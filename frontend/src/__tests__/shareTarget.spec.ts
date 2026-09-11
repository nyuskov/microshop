import { describe, expect, it } from 'vitest'
import {
  hasShareTargetParams,
  shareTargetFromSearch,
  shareTargetText,
  withoutShareTargetParams
} from '@/utils/shareTarget'

describe('shareTargetText', () => {
  it('склеивает заголовок и ссылку (как Chrome «Поделиться страницей»)', () => {
    expect(shareTargetText('Интересная статья', null, 'https://habr.com/ru/feed/')).toBe(
      'Интересная статья\nhttps://habr.com/ru/feed/'
    )
  })

  it('не дублирует ссылку, если она уже есть в тексте', () => {
    expect(
      shareTargetText(
        '',
        'Смотри видео https://youtu.be/SOi0APxsdgE',
        'https://youtu.be/SOi0APxsdgE'
      )
    ).toBe('Смотри видео https://youtu.be/SOi0APxsdgE')
  })

  it('работает, когда пришла только ссылка', () => {
    expect(shareTargetText(null, null, 'https://example.com/')).toBe('https://example.com/')
  })

  it('возвращает null, если делиться нечем', () => {
    expect(shareTargetText(null, '   ', '')).toBeNull()
    expect(shareTargetText('', '', '')).toBeNull()
  })
})

describe('shareTargetFromSearch', () => {
  it('достаёт текст из параметров Chrome', () => {
    expect(
      shareTargetFromSearch('?text=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82&url=https%3A%2F%2Fa.com')
    ).toEqual({ text: 'привет\nhttps://a.com' })
  })

  it('возвращает null, если параметров нет или они пустые', () => {
    expect(shareTargetFromSearch('')).toBeNull()
    expect(shareTargetFromSearch('?chat=14')).toBeNull()
    expect(shareTargetFromSearch('?text=&url=')).toBeNull()
  })

  it('не путает обычные параметры приложения с «поделиться»', () => {
    expect(hasShareTargetParams('?chat=14&markread=1')).toBe(false)
    expect(hasShareTargetParams('?text=привет')).toBe(true)
  })
})

describe('withoutShareTargetParams', () => {
  it('убирает параметры «поделиться», сохраняя остальные', () => {
    expect(
      withoutShareTargetParams('https://pismo.space/?chat=14&text=привет&url=https%3A%2F%2Fa.com')
    ).toBe('/?chat=14')
  })

  it('оставляет адрес без параметров как есть', () => {
    expect(withoutShareTargetParams('https://pismo.space/?chat=14')).toBe('/?chat=14')
    expect(withoutShareTargetParams('https://pismo.space/')).toBe('/')
  })
})
