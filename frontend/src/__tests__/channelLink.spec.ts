import { describe, expect, it } from 'vitest'
import {
  channelLinkFor,
  channelUsernameFromPath,
  isValidChannelUsername,
  normalizeChannelUsername
} from '@/utils/channelLink'

describe('normalizeChannelUsername', () => {
  it('убирает собаку и приводит к нижнему регистру', () => {
    expect(normalizeChannelUsername('@News_Channel')).toBe('news_channel')
  })

  it('обрезает пробелы и возвращает null для пустого', () => {
    expect(normalizeChannelUsername('  news  ')).toBe('news')
    expect(normalizeChannelUsername('')).toBeNull()
    expect(normalizeChannelUsername(null)).toBeNull()
  })
})

describe('isValidChannelUsername', () => {
  it('принимает адреса по правилам сервера', () => {
    expect(isValidChannelUsername('news')).toBe(true)
    expect(isValidChannelUsername('news_2026')).toBe(true)
    expect(isValidChannelUsername('@a1_b2c3')).toBe(true)
  })

  it('отвергает короткие, длинные и с недопустимыми символами', () => {
    expect(isValidChannelUsername('abc')).toBe(false)
    expect(isValidChannelUsername('1news')).toBe(false)
    expect(isValidChannelUsername('news-channel')).toBe(false)
    expect(isValidChannelUsername('новости')).toBe(false)
    expect(isValidChannelUsername('a'.repeat(33))).toBe(false)
  })
})

describe('channelLinkFor', () => {
  it('собирает ссылку на публичный канал', () => {
    expect(channelLinkFor('news')).toBe('https://pismo.space/c/news')
  })

  it('возвращает null, если адреса нет или он недопустимый', () => {
    expect(channelLinkFor(null)).toBeNull()
    expect(channelLinkFor('ab')).toBeNull()
    expect(channelLinkFor('news-channel')).toBeNull()
  })
})

describe('channelUsernameFromPath', () => {
  it('читает адрес из ссылки', () => {
    expect(channelUsernameFromPath('/c/news')).toBe('news')
    expect(channelUsernameFromPath('/c/news/')).toBe('news')
    expect(channelUsernameFromPath('/c/NEWS')).toBe('news')
  })

  it('возвращает null для чужих путей и мусора', () => {
    expect(channelUsernameFromPath('/u/news')).toBeNull()
    expect(channelUsernameFromPath('/')).toBeNull()
    expect(channelUsernameFromPath('/c/ab')).toBeNull()
    expect(channelUsernameFromPath('/c/%D0%9D')).toBeNull()
    expect(channelUsernameFromPath('/c/')).toBeNull()
  })
})
