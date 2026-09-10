import { afterEach, describe, expect, it, vi } from 'vitest'

import { screenShareNotice, screenShareSupport } from '@/stores/call'

/**
 * Причины недоступности показа экрана: раньше на любую из них интерфейс говорил
 * «Браузер не поддерживает демонстрацию экрана» — и это сбивало с толку, когда на
 * самом деле открыт http или телефон.
 */
const originalUserAgent = navigator.userAgent

function stubEnv(options: {
  ua?: string
  secure?: boolean
  mediaDevices?: unknown
  getDisplayMedia?: unknown
}): void {
  vi.stubGlobal('window', { isSecureContext: options.secure ?? true })
  const mediaDevices =
    options.mediaDevices === undefined
      ? options.getDisplayMedia === undefined
        ? undefined
        : { getDisplayMedia: options.getDisplayMedia }
      : options.mediaDevices
  vi.stubGlobal('navigator', { userAgent: options.ua ?? originalUserAgent, mediaDevices })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('screenShareSupport', () => {
  it('в десктопном браузере с API показывает «ok»', () => {
    stubEnv({ ua: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0', getDisplayMedia: () => {} })
    expect(screenShareSupport()).toBe('ok')
  })

  it('по http (незащищённый контекст) сообщает про HTTPS', () => {
    stubEnv({ secure: false, getDisplayMedia: () => {} })
    expect(screenShareSupport()).toBe('insecure')
    expect(screenShareNotice('insecure')).toContain('HTTPS')
  })

  it('без mediaDevices (http в старом браузере) тоже про HTTPS', () => {
    stubEnv({ secure: true, mediaDevices: undefined })
    expect(screenShareSupport()).toBe('insecure')
  })

  it('на телефоне без API говорит, что нужен компьютер', () => {
    // mediaDevices есть (HTTPS), но захвата экрана в мобильной сборке нет.
    stubEnv({
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140.0 Mobile',
      mediaDevices: {}
    })
    expect(screenShareSupport()).toBe('mobile')
    expect(screenShareNotice('mobile')).toContain('компьютера')
  })

  it('в WebView (Android-приложение) — тот же ответ про компьютер', () => {
    stubEnv({ ua: 'Mozilla/5.0 (Linux; Android 13; PismoApp/1.0) wv', mediaDevices: {} })
    expect(screenShareSupport()).toBe('mobile')
  })

  it('на десктопе без API — именно «браузер не поддерживает»', () => {
    stubEnv({ ua: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0', mediaDevices: {} })
    expect(screenShareSupport()).toBe('unsupported')
    expect(screenShareNotice('unsupported')).toContain('не поддерживает')
  })

  it('для «ok» текст пустой (показывать нечего)', () => {
    expect(screenShareNotice('ok')).toBe('')
  })
})
