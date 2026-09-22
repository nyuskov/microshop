/**
 * Политика паролей на клиенте — зеркало серверной (`backend/core/passwords.py`).
 *
 * Нужна для мгновенной подсказки до отправки формы: сервер всё равно проверяет
 * пароль сам и вернёт 400 с тем же текстом. Держим правила синхронными: длина,
 * чёрный список частых паролей, запрет данных аккаунта, однообразных и
 * последовательных строк.
 */

import { t } from '@/i18n'

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128

const REPEAT_RUN = 4
const SEQUENCE_RUN = 4

/** Частые пароли (нижний регистр) — подмножество серверного списка. */
const COMMON_PASSWORDS = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '222222',
  '333333',
  '000000',
  '123123123',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'qweasdzxc',
  '1q2w3e4r',
  '1qaz2wsx',
  'asdfghjkl',
  'zxcvbnm',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'admin',
  'admin123',
  'welcome',
  'letmein',
  'iloveyou',
  'privet',
  'parol',
  'parol123',
  'йцукен',
  'пароль',
  'привет',
  'любовь',
  'россия',
  'москва'
])

export interface PasswordContext {
  /** Номер телефона пользователя (как хранится на сервере). */
  phoneNumber?: string | null
  email?: string | null
  username?: string | null
}

const digitsOnly = (value: string): string => value.replace(/\D/g, '')

const hasSameCharRun = (password: string, run: number): boolean => {
  let streak = 1
  for (let index = 1; index < password.length; index += 1) {
    streak = password[index] === password[index - 1] ? streak + 1 : 1
    if (streak >= run) return true
  }
  return false
}

const hasSequenceRun = (password: string, run: number): boolean => {
  let streak = 1
  for (let index = 1; index < password.length; index += 1) {
    const step = password.charCodeAt(index) - password.charCodeAt(index - 1)
    streak = step === 1 || step === -1 ? streak + 1 : 1
    if (streak >= run) return true
  }
  return false
}

function personalDataInPassword(password: string, context: PasswordContext): string | null {
  const candidate = password.toLowerCase()
  const phone = context.phoneNumber ? digitsOnly(context.phoneNumber) : ''
  if (phone.length >= 10) {
    const passwordDigits = digitsOnly(password)
    if (passwordDigits.includes(phone) || passwordDigits.includes(phone.slice(-10))) {
      return t('номер телефона')
    }
  }

  const emailLocal = context.email ? (context.email.split('@')[0]?.toLowerCase() ?? '') : ''
  if (emailLocal.length >= 3 && candidate.includes(emailLocal)) {
    return t('адрес почты')
  }

  const username = context.username?.toLowerCase() ?? ''
  if (username.length >= 3 && candidate.includes(username)) {
    return t('логин')
  }

  return null
}

/** Причина отказа или `null`, если пароль допустим (тексты совпадают с сервером). */
export function passwordProblem(password: string, context: PasswordContext = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return t('Пароль должен быть не короче {count} символов.', { count: PASSWORD_MIN_LENGTH })
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return t('Пароль не может быть длиннее {count} символов.', { count: PASSWORD_MAX_LENGTH })
  }
  if (COMMON_PASSWORDS.has(password.trim().toLowerCase())) {
    return t('Такой пароль слишком часто встречается — выберите другой.')
  }
  if (/^\d+$/.test(password)) {
    return t('Пароль не должен состоять только из цифр.')
  }
  if (hasSameCharRun(password, REPEAT_RUN)) {
    return t('Пароль не должен содержать {count} одинаковых символа подряд.', {
      count: REPEAT_RUN
    })
  }
  if (hasSequenceRun(password, SEQUENCE_RUN)) {
    return t('Пароль не должен быть простой последовательностью символов.')
  }

  const personal = personalDataInPassword(password, context)
  if (personal) {
    return t('Пароль не должен содержать {what}.', { what: personal })
  }

  return null
}

/**
 * Грубая оценка «силы» для подсказки под полем (не влияет на приём пароля).
 * Сила растёт от длины и разнообразия символов.
 */
export function passwordStrength(password: string): {
  score: 0 | 1 | 2 | 3
  label: string
} {
  if (!password) return { score: 0, label: '' }
  const classes = [/[a-zа-я]/, /[A-ZА-Я]/, /\d/, /[^A-Za-zА-Яа-я0-9]/].filter((pattern) =>
    pattern.test(password)
  ).length
  const long = password.length >= 14
  const medium = password.length >= PASSWORD_MIN_LENGTH

  if (!medium || classes <= 1) return { score: 1, label: t('Слабый') }
  if (long && classes >= 3) return { score: 3, label: t('Хороший') }
  return { score: 2, label: t('Нормальный') }
}
