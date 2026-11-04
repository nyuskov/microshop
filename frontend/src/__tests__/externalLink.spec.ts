import { describe, expect, it } from 'vitest'
import { absoluteUrl, isExternalLink, linkHostOf } from '@/utils/externalLink'

describe('absoluteUrl', () => {
  it('достраивает относительные адреса', () => {
    expect(absoluteUrl('/privacy.html')).toBe(`${window.location.origin}/privacy.html`)
  })

  it('возвращает пустую строку для мусора', () => {
    expect(absoluteUrl('')).toBe('')
    expect(absoluteUrl('   ')).toBe('')
  })
})

describe('linkHostOf', () => {
  it('возвращает домен без www', () => {
    expect(linkHostOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
    expect(linkHostOf('https://habr.com/ru/feed')).toBe('habr.com')
  })

  it('для mailto отдаёт схему', () => {
    expect(linkHostOf('mailto:help@pismo.space')).toBe('mailto')
  })
})

describe('isExternalLink', () => {
  it('чужие сайты — внешние', () => {
    expect(isExternalLink('https://youtube.com/watch?v=1')).toBe(true)
    expect(isExternalLink('http://example.com/')).toBe(true)
  })

  it('свои адреса — внутренние', () => {
    expect(isExternalLink('https://pismo.space/u/ivan')).toBe(false)
    expect(isExternalLink('https://www.pismo.space/')).toBe(false)
  })

  it('относительные адреса и текущий origin — внутренние', () => {
    expect(isExternalLink('/privacy.html')).toBe(false)
    expect(isExternalLink(`${window.location.origin}/?chat=5`)).toBe(false)
  })

  it('почта и телефон — внешние (открывают другое приложение)', () => {
    expect(isExternalLink('mailto:help@pismo.space')).toBe(true)
    expect(isExternalLink('tel:+79991234567')).toBe(true)
  })

  it('мусор внешним не считается', () => {
    expect(isExternalLink('')).toBe(false)
  })
})
