/**
 * Отчёт о падении приложения — на наш сервер (свой «Sentry»).
 *
 * Зачем: экран фатальной ошибки (`FatalErrorScreen`) показывает текст падения
 * человеку, а нам он не виден — в логах сервера клиентской ошибки нет. Внешний
 * трекер (Sentry и подобные) в проекте не подходит: это передача данных за
 * границу, от которой отказались и для метрик (см. `docs/rkn-notification.md`).
 * Поэтому отчёт уходит на свой эндпоинт (`POST /api/v1/system/client-error/`),
 * оттуда — в лог и метрику, а текст ошибки — владельцу письмом.
 *
 * Что уходит: текст ошибки, стек, страница, сборка (`__BUILD_INFO__`) и — если
 * человек вошёл — его id (по access-токену). Ни тел сообщений, ни ключей E2EE,
 * ни query-строки: в ней бывают id чата и параметры звонка, а для разбора
 * хватает пути.
 *
 * Отчёт НЕ должен мешать: ошибка отправки глотается, ответ не читается, а запрос
 * помечен `keepalive` — иначе перезагрузка страницы (обычное действие на экране
 * ошибки) оборвала бы его на полпути.
 */
import { API_BASE_URL } from '@/config'

/** Ключ сохранённой сессии (см. `stores/auth.ts`). */
const AUTH_STATE_KEY = 'authState'

//: Совпадают с максимумами эндпоинта (`api_v1/system/views.py`): сервер обрежет
//: сам, но отправлять заведомо лишнее незачем.
const MAX_MESSAGE = 1000
const MAX_STACK = 2000
const MAX_PAGE = 200

/** Access-токен из сохранённой сессии: без него отчёт уйдёт анонимным. */
const accessToken = (): string | null => {
  try {
    const raw = window.localStorage.getItem(AUTH_STATE_KEY)
    if (!raw) return null
    return (JSON.parse(raw) as { accessToken?: string | null }).accessToken ?? null
  } catch {
    return null
  }
}

const cut = (value: string, limit: number): string => value.slice(0, limit)

/**
 * Отправляет отчёт об ошибке. Никогда не бросает и ничего не возвращает: экран
 * ошибки уже показан, второй сбой в этом месте только запутал бы человека.
 */
export const sendClientError = async (message: string, stack?: string | null): Promise<void> => {
  try {
    const token = accessToken()
    await fetch(`${API_BASE_URL}/system/client-error/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      keepalive: true,
      body: JSON.stringify({
        message: cut(message, MAX_MESSAGE),
        stack: stack ? cut(stack, MAX_STACK) : null,
        page: cut(window.location.pathname, MAX_PAGE),
        build: `${__BUILD_INFO__.commit} ${__BUILD_INFO__.date}`
      })
    })
  } catch {
    // Молча: сообщить человеку «отчёт не ушёл» нечем и незачем.
  }
}
