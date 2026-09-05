import axios from 'axios'

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
