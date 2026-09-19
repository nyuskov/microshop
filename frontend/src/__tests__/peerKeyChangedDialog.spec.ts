/**
 * Предупреждение «собеседник сменил ключ шифрования».
 *
 * Проверяем, что диалог объясняет ситуацию по-человечески (называет собеседника
 * и не пугает зря), что текст короткий — решение надо принять за пару секунд,
 * и что основная кнопка подтверждает новое устройство: иначе после проверки
 * предупреждение всплывало бы при каждом входе.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import PeerKeyChangedDialog from '@/components/messenger/PeerKeyChangedDialog.vue'

/** Упрощённые заглушки Quasar: нам важны текст и клик, а не вид. */
const stubFor = { template: '<div><slot /></div>' }

const mountDialog = (peerName?: string) =>
  mount(PeerKeyChangedDialog, {
    props: { modelValue: true, peerName },
    global: {
      directives: { 'close-popup': () => undefined },
      stubs: {
        'q-dialog': stubFor,
        'q-card': stubFor,
        'q-card-section': stubFor,
        'q-separator': true,
        'q-space': true,
        'q-icon': true,
        'q-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' }
      }
    }
  })

describe('PeerKeyChangedDialog', () => {
  it('называет собеседника и объясняет, что бывает и хорошо, и плохо', () => {
    const text = mountDialog('Аня').text()
    expect(text).toContain('Аня')
    expect(text).toContain('новое устройство')
    expect(text).toContain('сможет читать')
    expect(text).toContain('не отправляйте')
  })

  it('без имени собеседника текст остаётся понятным', () => {
    const text = mountDialog().text()
    expect(text).toContain('У собеседника новое устройство')
  })

  /**
   * Замечание 19.09.2026: «слишком много текста». Вместо трёх абзацев — три
   * короткие строки (что случилось / чем плохо / что делать), иначе предупреждение
   * не читают, а просто закрывают.
   */
  it('текст остаётся коротким: заголовок и три строки', () => {
    const wrapper = mountDialog('Аня')
    const text = wrapper.text().replace(/\s+/g, ' ').trim()

    expect(text.length).toBeLessThan(360)
    for (const block of wrapper.findAll('.pk-lead, .pk-danger, .pk-foot')) {
      expect(block.text().length).toBeLessThan(140)
    }
  })

  it('подтверждение устройства закрывает диалог и сообщает об этом наружу', async () => {
    const wrapper = mountDialog('Аня')
    const buttons = wrapper.findAll('.pk-actions button')
    expect(buttons.length).toBe(2)

    await buttons[0].trigger('click')

    // Заглушка кнопки отдаёт и «своё» событие, и нативное — считаем не число
    // вызовов, а сам факт подтверждения (acceptPeerKey идемпотентна).
    expect(wrapper.emitted('accept')).toBeTruthy()
    expect(wrapper.emitted('accept')!.length).toBeGreaterThan(0)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('«Проверю позже» не подтверждает устройство (спросим в следующий раз)', async () => {
    const wrapper = mountDialog('Аня')
    await wrapper.findAll('.pk-actions button')[1].trigger('click')

    expect(wrapper.emitted('accept')).toBeUndefined()
  })
})
