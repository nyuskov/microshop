import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Приватность присутствия: настройка должна доходить до сервера.
 *
 * Проверяем именно ПРОВОДКУ, а не вид: переключатель в разделе «Приватность»
 * должен попадать в тело PATCH (`presence_hidden` — колонка на `user`, а не на
 * профиле, поэтому он идёт рядом с `status`), а начальное значение — приходить
 * из `current_user`. Сломанная проводка выглядит как «галочка не работает», и
 * заметить это по типам нельзя.
 */
describe('приватность присутствия', () => {
  const profile = readFileSync('src/views/UserProfile.vue', 'utf8')
  const auth = readFileSync('src/stores/auth.ts', 'utf8')

  it('галочка стоит в разделе «Приватность» и сохраняется сразу', () => {
    expect(profile).toContain('v-model="profileForm.presence_hidden"')
    expect(profile).toMatch(/presence_hidden[\s\S]{0,120}onPrivacyToggle/)
  })

  it('значение уходит на сервер и приходит из current_user', () => {
    expect(profile).toContain('presence_hidden: profileForm.presence_hidden')
    expect(profile).toContain('user.presence_hidden ?? false')
    expect(auth).toContain('presence_hidden?: boolean')
  })
})
