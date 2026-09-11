/**
 * Приём «Поделиться» в PWA (запись `share_target` в `manifest.webmanifest`).
 *
 * В нативном приложении Android содержимое приходит интентом `ACTION_SEND`
 * (мост `PismoNative`, см. `services/nativeShare.ts`), а установленная PWA
 * получает его иначе: Chrome открывает страницу с параметрами
 * `/?title=…&text=…&url=…`. Здесь это превращается в тот же текст, что уходит в
 * чат, — дальше путь общий (см. `acceptIncomingShare` в `Messenger.vue`).
 *
 * Ограничения веб-варианта (по сравнению с приложением из RuStore):
 *  - только ссылки и текст: картинки требуют `method: POST` с файлом на сервер;
 *  - только Chrome на Android — в iOS `share_target` не поддерживается вовсе.
 *
 * Функции чистые (кроме `withoutShareTargetParams`, которой нужен адрес) — на них
 * есть тесты.
 */

/** Имена параметров, которые дописывает Chrome при «Поделиться». */
const TITLE_PARAM = 'title'
const TEXT_PARAM = 'text'
const URL_PARAM = 'url'
const SHARE_PARAMS = [TITLE_PARAM, TEXT_PARAM, URL_PARAM]

/** Содержимое «поделиться», готовое к отправке в чат. */
export interface ShareTargetPayload {
  /** Текст (ссылка из браузера обычно и есть текст). */
  text: string
}

/**
 * Склеивает части, которые передал Chrome, в текст сообщения.
 *
 * Chrome кладёт в `title` заголовок страницы, в `text` — выделенный текст, а в
 * `url` — адрес. Берём непустые части по порядку и не повторяем то, что уже
 * вошло в предыдущую часть (ссылка часто есть и в тексте, и в `url`).
 * `null` — делиться нечем.
 */
export function shareTargetText(
  title: string | null | undefined,
  text: string | null | undefined,
  url: string | null | undefined
): string | null {
  const parts: string[] = []
  for (const raw of [title, text, url]) {
    const value = (raw ?? '').trim()
    if (!value) continue
    if (parts.some((part) => part.includes(value))) continue
    parts.push(value)
  }
  return parts.length ? parts.join('\n') : null
}

/** Есть ли в адресе «поделиться» из PWA. */
export function hasShareTargetParams(search: string): boolean {
  const params = new URLSearchParams(search ?? '')
  return SHARE_PARAMS.some((name) => params.has(name))
}

/** Достаёт содержимое «поделиться» из адреса; `null` — если это не оно. */
export function shareTargetFromSearch(search: string): ShareTargetPayload | null {
  if (!hasShareTargetParams(search)) return null
  const params = new URLSearchParams(search ?? '')
  const text = shareTargetText(
    params.get(TITLE_PARAM),
    params.get(TEXT_PARAM),
    params.get(URL_PARAM)
  )
  return text ? { text } : null
}

/**
 * Адрес без параметров «поделиться»: содержимое уже забрали, а длинную ссылку с
 * текстом в адресной строке и истории держать незачем (и она мешала бы
 * обычным параметрам вроде `?chat=`).
 */
export function withoutShareTargetParams(currentUrl: string): string {
  const url = new URL(
    currentUrl,
    typeof window === 'undefined' ? 'https://pismo.space' : window.location.origin
  )
  for (const name of SHARE_PARAMS) url.searchParams.delete(name)
  return `${url.pathname}${url.search}${url.hash}`
}
