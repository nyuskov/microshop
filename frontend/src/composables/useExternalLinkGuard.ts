/**
 * Подтверждение перехода на внешний сайт.
 *
 * Состояние живёт на уровне модуля: окно подтверждения одно на всё приложение
 * (`components/common/ExternalLinkDialog.vue`, смонтировано в `App.vue`), а
 * вызвать его можно откуда угодно — из текста сообщения, из карточки ссылки,
 * из списка файлов.
 */

import { ref, type Ref } from 'vue'
import { nativeBridge } from '@/services/nativePush'
import { absoluteUrl, isExternalLink, linkHostOf } from '@/utils/externalLink'

export interface PendingExternalLink {
  /** Абсолютный адрес, куда собираемся перейти. */
  url: string
  /** Домен для подписи («youtube.com»). */
  host: string
}

/** Ссылка, ожидающая ответа пользователя (null — окно закрыто). */
const pendingLink = ref<PendingExternalLink | null>(null)
let answerResolver: ((answer: ExternalAnswer) => void) | null = null

/** Ответ на вопрос о переходе: разрешено ли и какое окно уже открыто. */
interface ExternalAnswer {
  allowed: boolean
  /** Новое окно, открытое прямо в обработчике клика (может быть null). */
  popup: Window | null
}

/**
 * Открывает внешний адрес «снаружи» приложения.
 *
 * Порядок важен:
 * 1. нативная оболочка Android — у неё есть свой способ открыть системный
 *    браузер (`PismoNative.openExternal`), и он надёжнее окна WebView;
 * 2. уже открытое окно (см. ниже) — просто уводим его на нужный адрес;
 * 3. новая вкладка — обычный браузер и установленное PWA;
 * 4. переход в текущем окне — если новое окно запрещено (WebView без поддержки
 *    нескольких окон): нативная оболочка перехватит адрес чужого домена и всё
 *    равно откроет браузер (см. `MainActivity.shouldOverrideUrlLoading`).
 */
export function openExternalUrl(url: string, popup?: Window | null): void {
  const absolute = absoluteUrl(url)
  if (!absolute || typeof window === 'undefined') return
  const bridge = nativeBridge()
  if (bridge?.openExternal) {
    popup?.close()
    bridge.openExternal(absolute)
    return
  }
  if (popup) {
    popup.location.replace(absolute)
    return
  }
  const opened = window.open(absolute, '_blank', 'noopener,noreferrer')
  if (!opened) window.location.assign(absolute)
}

/** Открывает свой адрес внутри приложения (полная загрузка — так работает разбор
 *  ссылки-профиля, см. `resolveProfileLink` в Messenger.vue). */
function openInternalLink(url: string): void {
  try {
    const parsed = new URL(url)
    window.location.assign(`${parsed.pathname}${parsed.search}${parsed.hash}`)
  } catch {
    window.location.assign(url)
  }
}

/**
 * Переход по ссылке из интерфейса: свой адрес открываем сразу, чужой — после
 * подтверждения. Ничего не возвращает: результат — сам переход.
 */
export async function followLink(rawUrl: string): Promise<void> {
  const url = absoluteUrl(rawUrl)
  if (!url) return
  if (!isExternalLink(url)) {
    openInternalLink(url)
    return
  }
  const answer = await askExternalLink(url)
  if (!answer.allowed) {
    answer.popup?.close()
    return
  }
  openExternalUrl(url, answer.popup)
}

/**
 * Спрашивает разрешение на переход на внешний сайт.
 * `true` — пользователь подтвердил (окно подтверждения откроется само).
 */
export async function confirmExternalLink(rawUrl: string): Promise<boolean> {
  const url = absoluteUrl(rawUrl)
  if (!url || !isExternalLink(url)) return true
  return (await askExternalLink(url)).allowed
}

/** Показывает вопрос о переходе и ждёт ответа. */
function askExternalLink(url: string): Promise<ExternalAnswer> {
  // Предыдущий вопрос (если был) считаем отменённым — окно одно.
  answerResolver?.({ allowed: false, popup: null })
  pendingLink.value = { url, host: linkHostOf(url) || url }
  return new Promise<ExternalAnswer>((resolve) => {
    answerResolver = resolve
  })
}

/** Используется окном подтверждения. */
export function useExternalLinkDialog(): {
  pending: Ref<PendingExternalLink | null>
  answer: (allowed: boolean, popup?: Window | null) => void
} {
  const answer = (allowed: boolean, popup: Window | null = null) => {
    const resolve = answerResolver
    answerResolver = null
    pendingLink.value = null
    resolve?.({ allowed, popup })
  }
  return { pending: pendingLink, answer }
}
