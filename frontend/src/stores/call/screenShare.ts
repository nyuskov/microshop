import { t } from '@/i18n'
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
  // Встроенный браузер редактора (Electron/VS Code) объявляет
  // `getDisplayMedia`, но захват не реализован: вызов отвечает
  // `NotSupportedError: Not supported`. Проверено живьём 19.09.2026 — владелец
  // нажал «Показать экран» в звонке и не понял, сработало ли («работает ли он —
  // не понятно»), потому что интерфейс молчал. Лучше сказать заранее.
  if (/\bElectron\b|Code\//.test(navigator.userAgent)) return 'embedded'
  return 'ok'
}

/** Текст для пользователя: почему показа экрана не будет. */
export function screenShareNotice(support: ScreenShareSupport): string {
  if (support === 'insecure') {
    return t('Показ экрана работает только по защищённому соединению (HTTPS)')
  }
  if (support === 'mobile') {
    return t('На телефоне показ экрана недоступен — включите его с компьютера')
  }
  if (support === 'embedded') {
    return t(
      'Во встроенном браузере захват экрана не работает — откройте приложение в обычном Chrome'
    )
  }
  if (support === 'unsupported') return t('Браузер не поддерживает демонстрацию экрана')
  return ''
}
