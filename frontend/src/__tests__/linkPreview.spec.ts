import { describe, expect, it } from 'vitest'
import {
  findLinks,
  firstLinkInText,
  isOwnLink,
  linkDomainOf,
  prettyLink
} from '@/utils/linkPreview'

describe('linkDomainOf', () => {
  it('убирает схему и www', () => {
    expect(linkDomainOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
    expect(linkDomainOf('habr.com/ru/feed')).toBe('habr.com')
  })

  it('возвращает пустую строку для мусора', () => {
    expect(linkDomainOf('не ссылка')).toBe('')
    expect(linkDomainOf('')).toBe('')
  })
})

describe('isOwnLink', () => {
  it('свои адреса не считаем внешними', () => {
    expect(isOwnLink('https://pismo.space/u/ivan')).toBe(true)
    expect(isOwnLink('https://pismo.space/?chat=5')).toBe(true)
  })

  it('чужие адреса — внешние', () => {
    expect(isOwnLink('https://youtube.com/watch?v=1')).toBe(false)
  })
})

describe('firstLinkInText', () => {
  it('находит ссылку со схемой', () => {
    expect(firstLinkInText('смотри https://youtube.com/watch?v=SOi0APxsdgE круто')).toBe(
      'https://youtube.com/watch?v=SOi0APxsdgE'
    )
  })

  it('находит адрес без схемы по известному домену', () => {
    expect(firstLinkInText('habr.com/ru/feed — полезно')).toBe('https://habr.com/ru/feed')
    expect(firstLinkInText('открой www.kinopoisk.ru/film/1/')).toBe(
      'https://www.kinopoisk.ru/film/1/'
    )
  })

  it('отбрасывает хвостовую пунктуацию', () => {
    expect(firstLinkInText('ссылка: https://lenta.ru/news/2026/09/11/ab/)).')).toBe(
      'https://lenta.ru/news/2026/09/11/ab/'
    )
  })

  it('не путает файлы и слова с ссылками', () => {
    expect(firstLinkInText('прислал photo.jpg')).toBeNull()
    expect(firstLinkInText('файл https://cdn.example.com/video.mp4')).toBeNull()
    expect(firstLinkInText('т.е. это не адрес')).toBeNull()
    expect(firstLinkInText('обычное сообщение без ссылок')).toBeNull()
  })

  it('не отдаёт свои ссылки (превью к ним не нужно)', () => {
    expect(firstLinkInText('моя ссылка https://pismo.space/u/ivan')).toBeNull()
    expect(firstLinkInText('https://pismo.space/')).toBeNull()
  })

  it('пустой текст — без ссылки', () => {
    expect(firstLinkInText(null)).toBeNull()
    expect(firstLinkInText(undefined)).toBeNull()
    expect(firstLinkInText('')).toBeNull()
  })

  it('берёт первую ссылку, если их несколько', () => {
    expect(firstLinkInText('https://a.com/1 и https://b.com/2')).toBe('https://a.com/1')
  })
})

describe('findLinks', () => {
  it('находит все ссылки с их позициями', () => {
    const text = 'a https://a.com/1 b habr.com/ru/feed'
    expect(findLinks(text)).toEqual([
      { index: 2, value: 'https://a.com/1', href: 'https://a.com/1' },
      { index: 20, value: 'habr.com/ru/feed', href: 'https://habr.com/ru/feed' }
    ])
  })

  it('не дублирует ссылку, найденную и со схемой, и без неё', () => {
    expect(findLinks('https://habr.com/ru/feed')).toEqual([
      { index: 0, value: 'https://habr.com/ru/feed', href: 'https://habr.com/ru/feed' }
    ])
  })

  it('наши ссылки тоже находит (по ним можно перейти внутри приложения)', () => {
    expect(findLinks('профиль https://pismo.space/u/ivan')).toEqual([
      { index: 8, value: 'https://pismo.space/u/ivan', href: 'https://pismo.space/u/ivan' }
    ])
  })

  it('файлы и текст без ссылок не трогает', () => {
    expect(findLinks('photo.jpg и просто текст')).toEqual([])
  })
})

describe('prettyLink', () => {
  it('убирает схему и обрезает длинное', () => {
    expect(prettyLink('https://example.com/a')).toBe('example.com/a')
    expect(prettyLink(`https://example.com/${'a'.repeat(80)}`).length).toBeLessThanOrEqual(48)
  })
})
