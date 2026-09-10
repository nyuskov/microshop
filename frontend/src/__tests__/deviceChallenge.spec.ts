/**
 * 2FA на новом устройстве: разбор ответа 428.
 *
 * Сервер на вход с незнакомого устройства не выдаёт токены, а отвечает 428 с
 * телом-челленджем (код отправлен на почту). Экран входа должен отличить этот
 * ответ от обычной ошибки — иначе вместо шага «введите код» человек увидит
 * «неверный пароль» и не поймёт, что делать.
 */
import { describe, expect, it } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'

import { deviceChallengeOf } from '../stores/auth'

function responseError(status: number, data: unknown): AxiosError {
  const error = new AxiosError('request failed')
  error.response = {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() }
  }
  return error
}

describe('deviceChallengeOf', () => {
  it('достаёт челлендж из ответа 428', () => {
    const challenge = deviceChallengeOf(
      responseError(428, {
        detail: {
          detail: 'Вход с нового устройства.',
          code_sent_to: 'iv***@mail.ru',
          challenge_token: 'token-123',
          expires_in: 600
        }
      })
    )

    expect(challenge).not.toBeNull()
    expect(challenge?.challenge_token).toBe('token-123')
    expect(challenge?.code_sent_to).toBe('iv***@mail.ru')
    expect(challenge?.expires_in).toBe(600)
  })

  it('игнорирует другие статусы (например, 401 «неверный пароль»)', () => {
    expect(deviceChallengeOf(responseError(401, { detail: 'Неверный пароль.' }))).toBeNull()
    expect(deviceChallengeOf(responseError(429, { detail: 'Слишком много попыток.' }))).toBeNull()
  })

  it('не падает на нестроковом detail и на сетевых ошибках', () => {
    expect(deviceChallengeOf(responseError(428, { detail: 'текст' }))).toBeNull()
    expect(deviceChallengeOf(new Error('network'))).toBeNull()
    expect(deviceChallengeOf(undefined)).toBeNull()
  })
})
