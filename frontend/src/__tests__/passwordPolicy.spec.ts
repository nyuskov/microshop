import { describe, expect, it } from 'vitest'

import { PASSWORD_MIN_LENGTH, passwordProblem, passwordStrength } from '../utils/passwordPolicy'

describe('passwordProblem', () => {
  it('требует минимальную длину (та же, что на сервере)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10)
    expect(passwordProblem('vesna-42')).toContain(String(PASSWORD_MIN_LENGTH))
  })

  it('отклоняет частые пароли', () => {
    expect(passwordProblem('qwertyuiop')).toBeTruthy()
    expect(passwordProblem('1234567890')).toBeTruthy()
  })

  it('отклоняет однообразные и последовательные строки', () => {
    expect(passwordProblem('korova1111moloko')).toContain('одинаковых')
    expect(passwordProblem('vesnaabcd-2026')).toContain('последовательностью')
  })

  it('запрещает пароль с номером телефона', () => {
    const problem = passwordProblem('vesna-79109744376', {
      phoneNumber: '+7 (910) 974-43-76'
    })
    expect(problem).toContain('телефона')
  })

  it('принимает длинную фразу без данных аккаунта', () => {
    expect(passwordProblem('vesna-listopad-42', { username: 'pismoSpace' })).toBeNull()
  })
})

describe('passwordStrength', () => {
  it('оценивает короткий пароль как слабый, длинную фразу — как хороший', () => {
    expect(passwordStrength('korova').score).toBe(1)
    expect(passwordStrength('Vesna-Listopad-42!').score).toBe(3)
  })

  it('для пустой строки ничего не показывает', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '' })
  })
})
