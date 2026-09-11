/**
 * Переходы по ссылкам: что считаем «внешним сайтом» и как туда попадаем.
 *
 * Мессенджер — это веб-приложение: у пользователя нет адресной строки, поэтому
 * переход на чужой сайт должен быть осознанным (и видимым) действием. Все
 * внешние переходы в интерфейсе идут через подтверждение — см.
 * `composables/useExternalLinkGuard.ts` и `components/common/ExternalLinkDialog.vue`.
 *
 * Чистые функции без DOM — на них есть тесты; сам переход — в
 * `composables/useExternalLinkGuard.ts` (там же диалог подтверждения).
 */

/** Наши домены: переход по ним остаётся внутри приложения. */
const OWN_HOSTS = new Set(['pismo.space'])

/** Схемы, которые тоже «уводят» из приложения (почта, звонок, SMS). */
const FOREIGN_SCHEMES = /^(mailto|tel|sms):/i

/** Приводит адрес к абсолютному виду ('' — если это не адрес). */
export function absoluteUrl(rawUrl: string, base?: string): string {
  const value = (rawUrl ?? '').trim()
  if (!value) return ''
  try {
    // base нужен для относительных адресов вроде «/privacy.html».
    return new URL(
      value,
      base ?? (typeof window === 'undefined' ? 'https://pismo.space' : window.location.origin)
    ).toString()
  } catch {
    return ''
  }
}

/** Домен ссылки без «www.» ('' — если это не обычный адрес). */
export function linkHostOf(url: string): string {
  const absolute = absoluteUrl(url)
  if (!absolute) return ''
  try {
    const parsed = new URL(absolute)
    if (!parsed.protocol.startsWith('http')) return parsed.protocol.replace(':', '')
    return parsed.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Ведёт ли ссылка за пределы Pismo.
 *
 * Внутренними считаем свои домены (`pismo.space`), текущий origin (dev, PWA на
 * своём адресе) и относительные адреса. `mailto:`/`tel:`/`sms:` — внешние: они
 * открывают чужое приложение, о переходе тоже предупреждаем.
 */
export function isExternalLink(url: string): boolean {
  const absolute = absoluteUrl(url)
  if (!absolute) return false
  if (FOREIGN_SCHEMES.test(absolute)) return true
  try {
    const parsed = new URL(absolute)
    if (!parsed.protocol.startsWith('http')) return false
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return false
    return !OWN_HOSTS.has(parsed.hostname.toLowerCase().replace(/^www\./, ''))
  } catch {
    return false
  }
}

/**
 * Открывает внешний адрес «снаружи» приложения.
 *
 * Порядок важен:
 * 1. нативная оболочка Android — у неё есть свой способ открыть системный
 *    браузер (`PismoNative.openExternal`), и он надёжнее окна WebView;
 * 2. новая вкладка — обычный браузер и установленное PWA;
 * 3. переход в текущем окне — если новое окно запрещено (WebView без поддержки
 *    нескольких окон): нативная оболочка перехватит адрес чужого домена и всё
 *    равно откроет браузер (см. `MainActivity.shouldOverrideUrlLoading`).
 */
export function openExternalUrl(url: string): void {
  const absolute = absoluteUrl(url)
  if (!absolute) return
  const bridge = typeof window === 'undefined' ? null : window.PismoNative
  if (bridge?.openExternal) {
    bridge.openExternal(absolute)
    return
  }
  const opened =
    typeof window === 'undefined' ? null : window.open(absolute, '_blank', 'noopener,noreferrer')
  if (!opened && typeof window !== 'undefined') {
    window.location.assign(absolute)
  }
}
