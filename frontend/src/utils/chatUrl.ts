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
