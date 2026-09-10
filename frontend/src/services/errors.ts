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
    const data = error.response?.data as { detail?: string; message?: string } | undefined
    return data?.detail || data?.message || error.message || fallback
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}
