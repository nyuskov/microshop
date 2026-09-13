import type { ScreenShareSupport } from './types'

/**
 * Проверяет, можно ли вообще включить показ экрана в этом окружении.
 * `getDisplayMedia` требует защищённый контекст (HTTPS или localhost), а в
 * мобильных браузерах и WebView захват экрана не поддерживается вовсе — там
 * звонок идёт, а API отсутствует, поэтому кнопку лучше не показывать.
 */
export function screenShareSupport(): ScreenShareSupport {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return 'unsupported'
  }
  if (!window.isSecureContext || !navigator.mediaDevices) return 'insecure'
  if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    return isMobile ? 'mobile' : 'unsupported'
  }
  return 'ok'
}

/** Текст для пользователя: почему показа экрана не будет. */
export function screenShareNotice(support: ScreenShareSupport): string {
  if (support === 'insecure') {
    return 'Показ экрана работает только по защищённому соединению (HTTPS)'
  }
  if (support === 'mobile') {
    return 'На телефоне показ экрана недоступен — включите его с компьютера'
  }
  if (support === 'unsupported') return 'Браузер не поддерживает демонстрацию экрана'
  return ''
}
