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

  it('на 413 без тела объясняет причину, а не повторяет код', () => {
    // Так отвечает nginx, когда тело больше `client_max_body_size`: в ответе
    // HTML-страница, `detail` нет, и раньше наружу уходило английское
    // «Request failed with status code 413».
    const error = {
      isAxiosError: true,
      response: { status: 413, data: '<html><head><title>413 ...</title></head></html>' },
      message: 'Request failed with status code 413'
    } as never
    const message = getErrorMessage(error, 'Не удалось опубликовать историю')
    expect(message).toContain('Файл слишком большой')
    expect(message).not.toContain('Request failed')
  })

  it('detail от сервера важнее нашего текста по коду', () => {
    const error = {
      isAxiosError: true,
      response: { status: 413, data: { detail: 'Хранилище заполнено: занято 250 МБ из 500 МБ' } }
    } as never
    expect(getErrorMessage(error)).toBe('Хранилище заполнено: занято 250 МБ из 500 МБ')
  })

  it('на неизвестный код показывает код — по нему видно, что смотреть в логах', () => {
    const error = {
      isAxiosError: true,
      response: { status: 418, data: '' }
    } as never
    expect(getErrorMessage(error, 'Не удалось отправить')).toContain('418')
  })

  it('таймаут и отсутствие связи объясняются по-русски', () => {
    const timeout = {
      isAxiosError: true,
      code: 'ECONNABORTED',
      message: 'timeout of 15000ms exceeded'
    } as never
    expect(getErrorMessage(timeout)).toContain('не ответил вовремя')

    const offline = { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' } as never
    expect(getErrorMessage(offline)).toContain('Нет подключения')
  })
})
