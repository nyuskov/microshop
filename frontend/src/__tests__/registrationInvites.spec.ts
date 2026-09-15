import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { inviteLinkFor, inviteState, type RegistrationInvite } from '@/services/invites'

/**
 * Приглашения на регистрацию: адрес ссылки и состояние.
 *
 * Состояние — то, по чему владелец понимает, почему ссылка не работает.
 * Порядок проверок важен: «по ссылке зарегистрировались» и «ссылка отозвана»
 * должны побеждать срок годности, иначе отозванная ссылка выглядела бы просто
 * истёкшей (и наоборот — истёкшая «использованной»).
 */
const base: RegistrationInvite = {
  id: 1,
  token: 'tok',
  phone_number: null,
  note: null,
  created_at: '2026-09-15T10:00:00Z',
  expires_at: null,
  used_at: null,
  revoked_at: null
}

const NOW = new Date('2026-09-15T12:00:00Z').getTime()

describe('inviteState', () => {
  it('без отметок — действует', () => {
    expect(inviteState(base, NOW)).toBe('active')
  })

  it('срок в будущем — ещё действует, срок в прошлом — истекла', () => {
    expect(inviteState({ ...base, expires_at: '2026-09-20T10:00:00Z' }, NOW)).toBe('active')
    expect(inviteState({ ...base, expires_at: '2026-09-15T09:00:00Z' }, NOW)).toBe('expired')
  })

  it('использованное важнее срока: по ссылке уже зарегистрировались', () => {
    const invite = {
      ...base,
      used_at: '2026-09-15T11:00:00Z',
      expires_at: '2026-09-15T11:30:00Z'
    }
    expect(inviteState(invite, NOW)).toBe('used')
  })

  it('отозванное важнее срока: ссылку погасили вручную', () => {
    const invite = { ...base, revoked_at: '2026-09-15T11:00:00Z' }
    expect(inviteState(invite, NOW)).toBe('revoked')
  })

  it('использование важнее отзыва: зарегистрировались, потом нечего отзывать', () => {
    const invite = {
      ...base,
      used_at: '2026-09-15T11:00:00Z',
      revoked_at: '2026-09-15T11:10:00Z'
    }
    expect(inviteState(invite, NOW)).toBe('used')
  })

  it('битая дата не делает ссылку недействительной на вид', () => {
    expect(inviteState({ ...base, expires_at: 'не-дата' }, NOW)).toBe('active')
  })
})

describe('inviteLinkFor', () => {
  it('собирает ссылку вида /invite/<token> на текущем домене', () => {
    expect(inviteLinkFor('abc', 'https://pismo.space')).toBe('https://pismo.space/invite/abc')
  })
})

/**
 * Срок действия ссылки в разделе «Приглашения».
 *
 * Раньше это был родной `<select>`: список рисует сам браузер, и в мобильном
 * WebView (и при нестандартном масштабе страницы) он открывается системным
 * окошком далеко от поля — жалоба пользователя 15.09.2026. Чипы всегда на месте.
 * Проверка статическая: jsdom не открывает родные списки, поэтому читаем исходник.
 */
describe('«Приглашения»: выбор срока действия', () => {
  const settings = readFileSync('src/components/messenger/InvitesSettings.vue', 'utf8')

  it('выбирается чипами, а не родным списком', () => {
    expect(settings).not.toContain('<select')
    expect(settings).toContain('role="radiogroup"')
    expect(settings).toMatch(/v-for="option in EXPIRY_OPTIONS"/)
  })

  it('все четыре варианта срока на месте', () => {
    expect(settings).toMatch(/label: 'Бессрочно'/)
    expect(settings).toMatch(/label: '1 день'/)
    expect(settings).toMatch(/label: '7 дней'/)
    expect(settings).toMatch(/label: '30 дней'/)
  })
})
