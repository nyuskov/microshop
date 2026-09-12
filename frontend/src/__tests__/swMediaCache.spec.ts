import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Проверки service worker по исходнику (`public/sw.js` не запускается в jsdom).
 *
 * Кэш медиа добавился из-за того, что аватары и превью грузились заново при
 * каждом открытии чата: `/media/` раньше был явно исключён из перехвата.
 */

describe('service worker: кэш медиа', () => {
  const sw = readFileSync('public/sw.js', 'utf8')

  it('кэширует картинки из /media/, но не видео и не API', () => {
    expect(sw).toContain("request.destination === 'image'")
    const branch = sw.slice(sw.indexOf("url.pathname.startsWith('/media/')"))
    expect(branch).toContain('mediaCacheFirst(request)')
    // Отдельный кэш: обновление версии приложения не сбрасывает картинки.
    expect(sw).toContain("const MEDIA_CACHE_PREFIX = 'pismo-media-v'")
    expect(sw).toContain('async function mediaCacheFirst(request)')
  })

  it('ограничивает размер кэша медиа', () => {
    expect(sw).toContain('const MEDIA_CACHE_LIMIT =')
    expect(sw).toContain('async function trimMediaCache(cache)')
    const trim = sw.slice(sw.indexOf('async function trimMediaCache(cache)'))
    expect(trim).toContain('cache.delete(key)')
  })

  it('чистит старые версии кэша медиа при активации', () => {
    const activate = sw.slice(
      sw.indexOf("self.addEventListener('activate'"),
      sw.indexOf("self.addEventListener('message'")
    )
    expect(activate).toContain('key.startsWith(MEDIA_CACHE_PREFIX)')
    expect(activate).toContain('key !== MEDIA_CACHE_NAME')
  })

  it('ассеты по-прежнему отдаются с обновлением в фоне', () => {
    expect(sw).toContain('async function staleWhileRevalidate(request')
    const branch = sw.slice(sw.indexOf("url.pathname.startsWith('/assets/')"))
    expect(branch).toContain('staleWhileRevalidate(request)')
  })
})

describe('service worker: бейдж приложения', () => {
  const sw = readFileSync('public/sw.js', 'utf8')

  it('при push о сообщении ставит «точку» на иконке, если приложение не на экране', () => {
    expect(sw).toContain('async function markAppBadge()')
    const branch = sw.slice(sw.indexOf("data.type === 'message' && chatId"))
    const until = branch.slice(0, branch.indexOf("data.type === 'security'"))
    expect(until).toContain('hasVisibleClient()')
    expect(until).toContain('await markAppBadge()')
  })

  it('точное число непрочитанных ставит приложение, а не service worker', () => {
    const badge = readFileSync('src/utils/appBadge.ts', 'utf8')
    expect(badge).toContain('setAppBadge')
    expect(badge).toContain('clearAppBadge')
    const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
    expect(messenger).toContain('setAppBadge(count)')
  })
})
