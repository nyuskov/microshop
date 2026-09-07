import { describe, expect, it } from 'vitest'

import { getErrorMessage } from '../services/errors'

describe('getErrorMessage', () => {
  it('возвращает detail из ответа бэкенда', () => {
    const error = {
      isAxiosError: true,
      response: { data: { detail: 'Код неверный' } }
    } as never
    expect(getErrorMessage(error)).toBe('Код неверный')
  })

  it('возвращает message, если нет detail', () => {
    const error = {
      isAxiosError: true,
      response: { data: { message: 'Сеть недоступна' } }
    } as never
    expect(getErrorMessage(error)).toBe('Сеть недоступна')
  })

  it('возвращает сообщение обычной ошибки', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('возвращает fallback для неизвестной ошибки', () => {
    expect(getErrorMessage(null)).toBe('Произошла ошибка.')
  })
})
