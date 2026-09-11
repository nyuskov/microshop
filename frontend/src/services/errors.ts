import axios from 'axios'

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
 * Возвращает человекочитаемое сообщение об ошибке.
 * Учитывает ответы бэкенда ({ detail } / { message }) и ошибки сети.
 */
export function getErrorMessage(error: unknown, fallback = 'Произошла ошибка.'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { detail?: unknown; message?: string } | undefined
    // detail может быть строкой или объектом { code, message } (2FA-челлендж,
    // заморозка аккаунта): в интерфейсе нужен человеческий текст, а не «[object]».
    if (typeof data?.detail === 'string' && data.detail) return data.detail
    if (data?.detail && typeof data.detail === 'object') {
      const message = (data.detail as { message?: unknown }).message
      if (typeof message === 'string' && message) return message
    }
    return data?.message || error.message || fallback
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}
