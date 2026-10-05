/**
 * Отчёт о падении приложения: что и как уезжает на наш сервер.
 *
 * Проверяем то, что важно для приватности и для разбора редких сбоев: уходит
 * текст с стеком и сборкой, НЕ уходит query-строка (в ней id чата), токен
 * прикладывается только когда человек вошёл, а любая ошибка отправки молча
 * глотается — экран ошибки уже показан, второй сбой там недопустим.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sendClientError } from '@/services/clientErrorReport'

const fetchMock = vi.fn()

const callOf = (index = 0): [string, RequestInit] =>
  fetchMock.mock.calls[index] as [string, RequestInit]

const bodyOf = (index = 0): Record<string, unknown> =>
  JSON.parse(String(callOf(index)[1].body)) as Record<string, unknown>

describe('sendClientError', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
    // Адрес с query: в нём бывают id чата и параметры звонка — уехать не должно.
    window.history.replaceState({}, '', '/?chat=7&call=abc')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('отправляет текст, стек, страницу и сборку', async () => {
    await sendClientError('boom', 'TypeError: boom\n  at x.vue:1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = callOf()
    expect(url).toContain('/system/client-error/')
    expect(init.method).toBe('POST')
    // Без keepalive перезагрузка страницы (обычное действие на экране ошибки)
    // оборвала бы отчёт.
    expect(init.keepalive).toBe(true)
    const body = bodyOf()
    expect(body.message).toBe('boom')
    expect(body.stack).toContain('TypeError')
    expect(body.page).toBe('/')
    // Сборка — «commit дата» из `__BUILD_INFO__`: в CI commit есть (GITHUB_SHA),
    // локально он пуст, поэтому проверяем форму, а не значение.
    expect(body.build).toMatch(/^[0-9a-f]{0,7} \d{4}-\d{2}-\d{2}$/)
  })

  it('не отправляет query-строку адреса', async () => {
    await sendClientError('boom')

    expect(String(bodyOf().page)).not.toContain('chat=7')
    expect(JSON.stringify(bodyOf())).not.toContain('call=abc')
  })

  it('обрезает длинные текст и стек по лимитам эндпоинта', async () => {
    await sendClientError('я'.repeat(5000), 'с'.repeat(5000))

    const body = bodyOf()
    expect(String(body.message)).toHaveLength(1000)
    expect(String(body.stack)).toHaveLength(2000)
  })

  it('прикладывает токен, если человек вошёл', async () => {
    window.localStorage.setItem('authState', JSON.stringify({ accessToken: 'tok' }))

    await sendClientError('boom')

    const headers = callOf()[1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('без входа уходит анонимно', async () => {
    await sendClientError('boom')

    const headers = callOf()[1].headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('молчит, если отправка не удалась', async () => {
    fetchMock.mockRejectedValue(new Error('нет сети'))

    await expect(sendClientError('boom')).resolves.toBeUndefined()
  })

  it('молчит, если сессия в localStorage испорчена', async () => {
    window.localStorage.setItem('authState', '{не json')

    await sendClientError('boom')

    const headers = callOf()[1].headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })
})

describe('экран фатальной ошибки', () => {
  afterEach(() => {
    vi.doUnmock('@/services/clientErrorReport')
    vi.resetModules()
  })

  it('отправляет отчёт с текстом и стеком, но не больше лимита показов', async () => {
    vi.resetModules()
    const sendClientErrorMock = vi.fn()
    vi.doMock('@/services/clientErrorReport', () => ({
      sendClientError: sendClientErrorMock
    }))
    const { fatalError, reportFatalError } = await import('@/utils/fatalError')

    const error = new Error('boom')
    reportFatalError(error)
    expect(fatalError.value).toBe('boom')
    expect(sendClientErrorMock).toHaveBeenCalledWith('boom', error.stack)

    // Экран показывают не больше трёх раз за сессию — отчётов тоже не больше:
    // иначе ошибка в цикле залила бы сервер своими отчётами.
    reportFatalError(new Error('раз'))
    reportFatalError(new Error('два'))
    reportFatalError(new Error('три'))
    expect(sendClientErrorMock).toHaveBeenCalledTimes(3)
  })
})
