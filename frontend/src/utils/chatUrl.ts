/**
 * Адрес страницы и открытый чат.
 *
 * Открытый чат держим только в адресной строке (`?chat=<id>`): перезагрузка
 * страницы (pull-to-refresh, кнопка «Обновить», возврат в PWA) возвращает в тот
 * же чат, а запуск приложения заново всегда открывает главную — список чатов.
 * Разбор и сборка адреса — чистые функции, поэтому их легко тестировать отдельно
 * от компонента.
 */

/** Параметр адреса с идентификатором открытого чата. */
export const CHAT_PARAM = 'chat'

/**
 * Одноразовый параметр «пометить чат прочитанным» (его ставят push-уведомления).
 * В адресе его не держим: после перезагрузки он уже не нужен.
 */
const EPHEMERAL_PARAMS = ['markread', 'reply']

/**
 * Одноразовый параметр «открыть чат готовым к вводу» (его ставит кнопка
 * «Ответить» в уведомлении). После открытия чат набирается сам — см.
 * `focusComposerOnLaunch`.
 */
const REPLY_PARAM = 'reply'

/** Доступ к localStorage (в приватном режиме его может не быть). */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    /* приватный режим или запрет доступа */
    return null
  }
}

/**
 * Была ли текущая загрузка страницы ПЕРЕЗАГРУЗКОЙ, а не запуском приложения.
 *
 * Разница принципиальная: при перезагрузке (pull-to-refresh, кнопка «Обновить»,
 * возврат в развёрнутое окно PWA) человека возвращаем туда, где он был, а при
 * запуске приложения заново всегда показываем главную — список чатов.
 */
export function isPageReload(): boolean {
  try {
    const entries = performance.getEntriesByType?.('navigation') ?? []
    const type = (entries[0] as { type?: string } | undefined)?.type
    return type === 'reload'
  } catch {
    return false
  }
}

/** id чата из строки параметров адреса; `null` — если параметра нет или он битый. */
export function chatIdFromUrl(search: string): number | null {
  const raw = new URLSearchParams(search).get(CHAT_PARAM)
  if (!raw || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Запуск по кнопке «Ответить» в уведомлении: нужно сразу поставить курсор в
 * поле ввода (сам браузер печатать в уведомлении не даёт — это ближайший
 * аналог быстрого ответа).
 */
export function isReplyLaunch(search: string): boolean {
  return new URLSearchParams(search).get(REPLY_PARAM) === '1'
}

/**
 * Адрес с открытым чатом (`chatId`) или без него (`null`).
 *
 * Прочие параметры сохраняются: по ним приложение возвращается в звонок после
 * перезагрузки (`?call=&peer=&action=`).
 */
export function chatUrlWith(currentUrl: string, chatId: number | null): string {
  const url = new URL(currentUrl, 'https://pismo.space')
  if (chatId === null) url.searchParams.delete(CHAT_PARAM)
  else url.searchParams.set(CHAT_PARAM, String(chatId))
  for (const param of EPHEMERAL_PARAMS) url.searchParams.delete(param)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Ключ, под которым помним раздел приложения (`chats`/`stories`/`contacts`).
 *
 * Нужен только для перезагрузки — см. `readStoredSection`.
 */
export const SECTION_STORAGE_KEY = 'pismo_view'

/** Допустимые разделы: всё прочее (мусор в хранилище) игнорируем. */
const SECTIONS = ['chats', 'stories', 'contacts'] as const

export type StoredSection = (typeof SECTIONS)[number]

/**
 * Раздел приложения, в котором был пользователь (`chats` / `stories` /
 * `contacts`).
 *
 * Помним его только для перезагрузки: кнопка «Обновить» и pull-to-refresh не
 * должны выкидывать человека из историй или контактов на «Чаты». Запуск
 * приложения заново всегда открывает главную, поэтому та память не читается.
 */
export function readStoredSection(storage: Storage | null = safeStorage()): StoredSection {
  if (!isPageReload()) {
    // Запуск приложения заново: всегда главная («Чаты»). Память приводим в
    // согласованность — иначе следующая перезагрузка вернула бы в старый раздел.
    storeSection('chats', storage)
    return 'chats'
  }
  try {
    const raw = storage?.getItem(SECTION_STORAGE_KEY)
    return SECTIONS.includes(raw as StoredSection) ? (raw as StoredSection) : 'chats'
  } catch {
    return 'chats'
  }
}

/** Запомнить раздел, чтобы перезагрузка вернула в него же. */
export function storeSection(
  section: StoredSection,
  storage: Storage | null = safeStorage()
): void {
  try {
    storage?.setItem(SECTION_STORAGE_KEY, section)
  } catch {
    /* приватный режим — просто не помним раздел */
  }
}
