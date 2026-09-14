import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Ссылка-приглашение `/invite/<токен>` — единственный способ создать аккаунт,
 * пока публичная регистрация выключена (см. backend/scripts/create_invite.py).
 * Маршрут обязан оставаться доступным без входа, иначе приглашённый не сможет
 * даже открыть форму регистрации.
 */
describe('маршрут ссылки-приглашения на регистрацию', () => {
  const router = readFileSync('src/router/index.ts', 'utf8')

  it('объявлен как путь /invite/:token', () => {
    expect(router).toContain("path: '/invite/:token'")
    expect(router).toContain("name: 'InviteRegister'")
  })

  it('исключён из общего auth-gate (доступен без входа)', () => {
    expect(router).toContain("to.name === 'InviteRegister'")
  })
})
