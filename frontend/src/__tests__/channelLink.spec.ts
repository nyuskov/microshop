import { readFileSync } from 'node:fs'
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

/**
 * Ссылка `/c/<адрес>` разбирается в `Messenger.vue`, но чтобы он вообще
 * смонтировался, маршрут должен быть объявлен в роутере: иначе адрес попадает в
 * `/:pathMatch(.*)*` и человек видит «Страница не найдена» вместо экрана подписки.
 */
describe('маршрут ссылки на канал', () => {
  const router = readFileSync('src/router/index.ts', 'utf8')

  it('объявлен как путь /c/:username', () => {
    expect(router).toContain("path: '/c/:username'")
    expect(router).toContain("name: 'ChannelLink'")
  })

  it('до входа защищён глобальным auth-gate', () => {
    expect(router).toContain('if (!authStore.isAuthenticated)')
    expect(router).toContain("next({ name: 'Login' })")
  })
})
