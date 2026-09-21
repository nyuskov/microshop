/**
 * Что за браузер: мобильный ли он и на движке ли Chromium.
 *
 * Одна точка правды для решений вида «эта возможность есть только в Chrome на
 * КОМПЬЮТЕРЕ»: их принимают и распознавание речи (`utils/voiceRecognition.ts` —
 * распознать ЗАПИСЬ умеет только он), и перевод (`utils/translation.ts` —
 * встроенный переводчик). Держать эти догадки врозь нельзя: они уже один раз
 * разошлись, и на телефоне человек видел тупик вместо функции.
 *
 * Точный ответ даёт `navigator.userAgentData.mobile`, но он есть только в
 * Chromium — остальным (Safari, Firefox, старые сборки) смотрим строку
 * User-Agent.
 */

export interface BrowserKind {
  /** Телефон или планшет. */
  mobile: boolean
  /** Движок Chromium (Chrome, Edge, Opera, WebView, Electron). */
  chromium: boolean
}

export const browserKind = (): BrowserKind => {
  if (typeof navigator === 'undefined') return { mobile: false, chromium: false }
  const ua = navigator.userAgent ?? ''
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  const known = typeof data?.mobile === 'boolean'
  return {
    mobile: known ? Boolean(data?.mobile) : /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua),
    chromium: known || /Chrome\/|Chromium\//.test(ua)
  }
}

/**
 * Chrome (Chromium) на компьютере — платформа встроенных моделей браузера.
 *
 * Так помечаем всё, что опирается на них: распознавание речи по файлу и перевод
 * на устройстве. В мобильном браузере и в Safari/Firefox этих моделей нет (или
 * есть только микрофон), поэтому «предлагать» там нечего.
 */
export const isDesktopChromium = (): boolean => {
  const kind = browserKind()
  return kind.chromium && !kind.mobile
}
