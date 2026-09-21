import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ErrorNotice from '@/components/common/ErrorNotice.vue'

/**
 * Плашка ошибки над полем ввода.
 *
 * До этого она жила до следующего действия: закрыть её было нельзя, сама она не
 * пропадала (проверено в живом приложении 20.09.2026 — «Не удалось отправить»
 * висело на экране шесть секунд и висело бы дальше). Здесь проверяем оба способа
 * закрытия: крестик и отсчёт времени.
 */
const mountNotice = (props: Record<string, unknown> = {}) =>
  mount(ErrorNotice, {
    props: { message: 'Не удалось отправить стикер', ...props },
    global: { stubs: { 'q-icon': true } }
  })

describe('плашка ошибки', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('показывает текст ошибки и крестик', () => {
    const wrapper = mountNotice()
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось отправить стикер')
    const close = wrapper.get('.error-notice-close')
    expect(close.attributes('aria-label')).toBe('Закрыть сообщение об ошибке')
  })

  it('крестик закрывает плашку', async () => {
    const wrapper = mountNotice()
    await wrapper.get('.error-notice-close').trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('сама уходит через 8 секунд', async () => {
    const wrapper = mountNotice()
    vi.advanceTimersByTime(7900)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
    vi.advanceTimersByTime(200)
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('свой срок: timeout задаётся снаружи', () => {
    const wrapper = mountNotice({ timeout: 3000 })
    vi.advanceTimersByTime(2900)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
    vi.advanceTimersByTime(200)
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('timeout: 0 — ждём крестик, сама не пропадает', () => {
    const wrapper = mountNotice({ timeout: 0 })
    vi.advanceTimersByTime(600000)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  it('пока курсор на плашке, отсчёт стоит', async () => {
    const wrapper = mountNotice()
    await wrapper.get('[role="alert"]').trigger('pointerenter')
    vi.advanceTimersByTime(30000)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
    // Ушёл курсор — отсчёт начинается заново, а не продолжается с прошлого места.
    await wrapper.get('[role="alert"]').trigger('pointerleave')
    vi.advanceTimersByTime(7900)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
    vi.advanceTimersByTime(200)
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('«Повторить» есть только когда повторять есть что', () => {
    const wrapper = mountNotice()
    expect(wrapper.find('.error-notice-retry').exists()).toBe(false)
  })

  it('«Повторить» просит повторить, но не закрывает плашку', async () => {
    const wrapper = mountNotice({ canRetry: true })
    const retry = wrapper.get('.error-notice-retry')
    // Кнопка без подписи — иконка повтора: текст ошибки не должен конкурировать
    // с двумя надписями справа, а имя остаётся доступным.
    expect(retry.attributes('aria-label')).toBe('Повторить отправку')
    expect(retry.attributes('title')).toBe('Повторить')
    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    // Гасит ошибку родитель: он же повторяет отправку.
    expect(wrapper.emitted('dismiss')).toBeUndefined()
  })

  it('новый текст ошибки начинает отсчёт заново', async () => {
    const wrapper = mountNotice()
    vi.advanceTimersByTime(4000)
    await wrapper.setProps({ message: 'Не удалось отправить сообщение' })
    vi.advanceTimersByTime(4000)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
    vi.advanceTimersByTime(4100)
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })
})

describe('связки в интерфейсе', () => {
  const composer = readFileSync('src/components/messenger/MessageComposer.vue', 'utf8')
  const sidebar = readFileSync('src/components/messenger/ChatSidebar.vue', 'utf8')
  const messenger = readFileSync('src/views/Messenger.vue', 'utf8')

  it('композер и список чатов показывают ошибки этой плашкой, а не голым div', () => {
    expect(composer).toContain("import ErrorNotice from '@/components/common/ErrorNotice.vue'")
    expect(composer).toContain(':message="sendError"')
    expect(composer).toContain(':can-retry="canRetrySend"')
    expect(sidebar).toContain("import ErrorNotice from '@/components/common/ErrorNotice.vue'")
    expect(sidebar).toContain('@dismiss="setSearchError(\'\')"')
    // Прежний класс жил в двух компонентах со своими стилями — вид плашки
    // должен быть один и лежать в самом компоненте.
    expect(composer).not.toContain('class="inline-error"')
    expect(sidebar).not.toContain('class="inline-error"')
  })

  it('крестик в композере гасит ошибку у родителя', () => {
    expect(messenger).toContain('@dismiss-error="sendError = \'\'"')
  })

  it('повтор отправки живёт у родителя: плашка только сообщает о нажатии', () => {
    expect(composer).toContain('@retry="emit(\'retry-error\')"')
    expect(messenger).toContain('@retry-error="retryFailedSend"')
    expect(messenger).toContain('const retrySend = ref<(() => void) | null>(null)')
    // Ошибку погасили — повтор больше не нужен (иначе крестик оставался бы с
    // невидимым «Повторить» для уже исчезнувшей ошибки).
    expect(messenger).toContain('if (!value) retrySend.value = null')
    // Повторяемые отправки называют его при сбое.
    expect(messenger).toContain("getErrorMessage(error, t('Не удалось отправить стикер')),")
    expect(messenger).toContain('() => void sendSticker(sticker)')
  })
})
