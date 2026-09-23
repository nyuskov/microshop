import axios from 'axios'

import { t } from '@/i18n'

/**
 * Похоже ли, что запрос не дошёл из-за связи (нет сети, обрыв, таймаут).
 *
 * Отличаем от ответа сервера: если ответа нет вовсе — это сеть, и сообщение
 * имеет смысл поставить в очередь и повторить, когда связь вернётся. Ответ
 * сервера (даже ошибка) означает, что повторять бессмысленно.
 */
export function isNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return error instanceof TypeError
  // Есть ответ — сервер ответил (ошибка в запросе/правах), это не сеть.
  if (error.response) return false
  const code = error.code ?? ''
  return (
    code === 'ERR_NETWORK' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    error.message.includes('Network Error')
  )
}

/**
 * Тексты для ответов, в которых объяснения от бэкенда нет.
 *
 * Так бывает, когда ответ формирует не приложение, а то, что стоит перед ним:
 * nginx на слишком большое тело отвечает СВОЕЙ HTML-страницей `413` (в теле нет
 * `detail`, до FastAPI запрос не доходит), шлюз отдаёт `502/504` со своей
 * разметкой. Без этой таблицы человек видел бы дословный ответ axios —
 * «Request failed with status code 413»: код без объяснения и на чужом языке.
 */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'Сервер не принял запрос. Проверьте данные и попробуйте ещё раз.',
  401: 'Сессия истекла — войдите заново.',
  403: 'Недостаточно прав для этого действия.',
  404: 'Не найдено: возможно, данные уже удалили.',
  405: 'Это действие здесь не поддерживается.',
  409: 'Не получилось: данные уже изменились (например, с другого устройства). Обновите и повторите.',
  // Лимит размера тела запроса: у бэкенда свой лимит на файл (`MAX_UPLOAD_SIZE`),
  // а у nginx — `client_max_body_size`. Файл сверх второго до приложения не
  // доходит, поэтому объясняем «крупный файл», а не «ошибка 413».
  413: 'Файл слишком большой — сервер не принял загрузку. Выберите файл меньше.',
  415: 'Такой формат файла не поддерживается.',
  422: 'Данные не прошли проверку на сервере.',
  429: 'Слишком много запросов. Подождите немного и повторите.',
  500: 'Ошибка на сервере. Попробуйте позже.',
  502: 'Сервер перезапускается. Попробуйте ещё раз через минуту.',
  503: 'Сервис временно недоступен. Попробуйте позже.',
  504: 'Сервер не ответил вовремя. Проверьте связь и повторите.'
}

/** Ответа нет вовсе: запрос не дошёл (нет сети, обрыв). */
const OFFLINE_MESSAGE = 'Нет подключения к серверу. Проверьте интернет и повторите.'
/** Запрос ушёл, но ответа не дождались (таймаут клиента). */
const TIMEOUT_MESSAGE = 'Сервер не ответил вовремя. Проверьте связь и повторите.'

/**
 * Русский текст 404-ответа сервера «чат не найден».
 *
 * Это строка СЕРВЕРА, а не подпись интерфейса: по ней узнаём, что чат удалили
 * или нас исключили из группы (серверные тексты всегда русские, см.
 * `docs/backend.md`). Переводить её нельзя — признак перестанет совпадать.
 */
const SERVER_CHAT_GONE_TEXT = 'чат не найден'

/**
 * Возвращает человекочитаемое сообщение об ошибке.
 *
 * Порядок разбора: объяснение бэкенда (`detail`/`message`) → наш текст по коду
 * ответа → текст про связь. Сырые сообщения axios (`Network Error`,
 * «Request failed with status code 413», «timeout of 15000ms exceeded»)
 * наружу НЕ отдаём: они английские и ничего не объясняют человеку.
 * Свои ошибки (обычный `Error`) проходят как есть — их тексты пишем мы сами.
 */
export function getErrorMessage(error: unknown, fallback = t('Произошла ошибка.')): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { detail?: unknown; message?: unknown } | undefined
    // detail может быть строкой или объектом { code, message } (2FA-челлендж,
    // заморозка аккаунта): в интерфейсе нужен человеческий текст, а не «[object]».
    if (typeof data?.detail === 'string' && data.detail) return data.detail
    if (data?.detail && typeof data.detail === 'object') {
      const message = (data.detail as { message?: unknown }).message
      if (typeof message === 'string' && message) return message
    }
    if (typeof data?.message === 'string' && data.message) return data.message
    const status = error.response?.status
    if (status) {
      // Код без таблицы (нестандартный ответ прокси): показываем и его — по
      // нему хотя бы понятно, куда смотреть в логах.
      return STATUS_MESSAGES[status]
        ? t(STATUS_MESSAGES[status]!)
        : t('Сервер ответил ошибкой {status}. {fallback}', { status, fallback })
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return t(TIMEOUT_MESSAGE)
    // Отменённый запрос (навигация, смена чата) — не поломка: молчим и отдаём
    // запасной текст, если вызывающий всё же решил его показать.
    if (isNetworkError(error) && error.code !== 'ERR_CANCELED') return t(OFFLINE_MESSAGE)
    return fallback
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

/**
 * Сервер ответил 404 «чат не найден».
 *
 * Бывает, когда чат удалили или вас исключили из группы, а приложение ещё
 * держит его открытым: тогда фоновое обновление идёт в никуда и сыпет ошибками
 * в консоль. По этому признаку интерфейс убирает такой чат из списка и
 * возвращает человека к чатам.
 */
export function isChatGoneError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false
  if (error.response?.status !== 404) return false
  // Сверяемся с текстом СЕРВЕРА (он всегда русский, см. docs/backend.md) — это
  // не подпись интерфейса, а признак ответа, поэтому строка не переводится.
  return getErrorMessage(error).toLowerCase().includes(SERVER_CHAT_GONE_TEXT)
}
