import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ConsentCheckbox from '@/components/common/ConsentCheckbox.vue'

/**
 * Галка согласия с документами сервиса (нужна при регистрации).
 *
 * jsdom не проверяет ни видимость, ни порядок полей, поэтому кроме поведения
 * компонента здесь есть стражи по исходникам экранов: галка обязана стоять на
 * регистрации (создание аккаунта) и НЕ появляться при обычном входе, а факт
 * согласия — уходить на сервер вместе с запросом регистрации.
 */
const loginSource = readFileSync('src/components/Login.vue', 'utf8')
const inviteSource = readFileSync('src/components/InviteRegister.vue', 'utf8')
const authSource = readFileSync('src/stores/auth.ts', 'utf8')
const checkboxSource = readFileSync('src/components/common/ConsentCheckbox.vue', 'utf8')

function mountConsent(props: { modelValue: boolean; invalid?: boolean }) {
  return mount(ConsentCheckbox, { props })
}

describe('ConsentCheckbox: сама галка', () => {
  it('по отметке отдаёт новое значение наружу', async () => {
    const wrapper = mountConsent({ modelValue: false })

    await wrapper.get('input[type="checkbox"]').setValue(true)

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
    wrapper.unmount()
  })

  it('перечисляет все документы сервиса ссылками на опубликованные страницы', () => {
    const wrapper = mountConsent({ modelValue: false })

    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'))
    expect(hrefs).toEqual(['/privacy.html', '/terms.html', '/community.html'])
    expect(wrapper.text()).toContain('обработку персональных данных')
    wrapper.unmount()
  })

  it('неотмеченная галка подсвечивается и помечается для скринридера', () => {
    const wrapper = mountConsent({ modelValue: false, invalid: true })

    expect(wrapper.classes()).toContain('consent--invalid')
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    wrapper.unmount()
  })

  it('ссылки не переключают саму галку', () => {
    // Клик по ссылке внутри <label> отмечает чекбокс — на экране регистрации это
    // означало бы «согласие» от одного лишь открытия политики. Гасим клик на
    // каждой ссылке; проверяем разметку, потому что jsdom такое поведение не
    // воспроизводит.
    const anchors = checkboxSource.split('<a ').slice(1)

    expect(anchors).toHaveLength(3)
    for (const anchor of anchors) {
      expect(anchor.slice(0, anchor.indexOf('>'))).toContain('@click.stop')
    }
  })
})

describe('регистрация: где спрашиваем согласие', () => {
  it('экран входа использует общий компонент галки и поля телефона', () => {
    expect(loginSource).toContain(
      "import ConsentCheckbox from '@/components/common/ConsentCheckbox.vue'"
    )
    expect(loginSource).toContain("import PhoneInput from '@/components/common/PhoneInput.vue'")
    expect(loginSource).not.toContain('mask="+7 (###) ###-##-##"')
  })

  it('согласие запрашивается только для НОВОГО аккаунта', () => {
    // Подтверждение кода на новом номере аккаунт уже создаёт, ввод пароля для
    // нового номера — тоже. Вход и «придумайте пароль» существующему аккаунту
    // галку не показывают: лишний шаг на входе раздражает.
    expect(loginSource).toMatch(/state\.value === 'otp' && isNewNumber\.value/)
    expect(loginSource).toMatch(
      /state\.value === 'create' && isNewNumber\.value && !afterOtp\.value/
    )
    expect(loginSource).toMatch(/v-if="consentRequired"/)
  })

  it('без галки аккаунт не создаётся', () => {
    expect(loginSource).toMatch(/if \(isNewNumber\.value && !requireConsent\(\)\) return/)
    expect(loginSource).toMatch(/if \(consentRequired\.value && !requireConsent\(\)\) return/)
    expect(inviteSource).toMatch(/if \(!acceptRules\.value\) \{/)
  })

  it('приглашение и экран входа используют ту же галку и поле телефона', () => {
    expect(inviteSource).toContain(
      "import ConsentCheckbox from '@/components/common/ConsentCheckbox.vue'"
    )
    expect(inviteSource).toContain("import PhoneInput from '@/components/common/PhoneInput.vue'")
  })

  it('факт согласия уходит на сервер вместе с каждым запросом регистрации', () => {
    // Три точки создания аккаунта: подтверждение кода (verify-otp), регистрация
    // по паролю и регистрация по приглашению.
    expect(authSource.match(/accept_terms: acceptTerms/g)).toHaveLength(3)
  })
})
