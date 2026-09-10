/**
 * Адрес страницы и открытый чат.
 *
 * Открытый чат держим в адресной строке (`?chat=<id>`), чтобы перезагрузка
 * страницы (в том числе pull-to-refresh в PWA) возвращала в тот же чат, а не в
 * список чатов. Разбор и сборка адреса — чистые функции, поэтому их легко
 * тестировать отдельно от компонента.
 */

/** Параметр адреса с идентификатором открытого чата. */
export const CHAT_PARAM = 'chat'

/**
 * Одноразовый параметр «пометить чат прочитанным» (его ставят push-уведомления).
 * В адресе его не держим: после перезагрузки он уже не нужен.
 */
const EPHEMERAL_PARAMS = ['markread']

/**
 * Ключ, под которым помним открытый чат между запусками приложения.
 *
 * Зачем, если есть `?chat=` в адресе: установленное приложение (PWA) при запуске
 * с домашнего экрана открывается по `start_url` — то есть просто «/», без
 * параметров. Без этой памяти каждый такой запуск начинался бы со списка чатов,
 * хотя человек просто вернулся в приложение.
 */
export const OPEN_CHAT_STORAGE_KEY = 'pismo_open_chat'

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    /* приватный режим или запрет доступа */
    return null
  }
}

/** id открытого чата из памяти приложения (`null` — ничего не помним). */
export function readStoredChatId(storage: Storage | null = safeStorage()): number | null {
  try {
    const raw = storage?.getItem(OPEN_CHAT_STORAGE_KEY)
    return raw && /^\d+$/.test(raw) ? Number(raw) : null
  } catch {
    return null
  }
}

/**
 * Запомнить открытый чат: `null` — чат закрыт (показывается список), помнить
 * нечего.
 */
export function storeChatId(chatId: number | null, storage: Storage | null = safeStorage()): void {
  try {
    if (chatId === null) storage?.removeItem(OPEN_CHAT_STORAGE_KEY)
    else storage?.setItem(OPEN_CHAT_STORAGE_KEY, String(chatId))
  } catch {
    /* не смогли сохранить — не страшно, адрес всё равно содержит чат */
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
