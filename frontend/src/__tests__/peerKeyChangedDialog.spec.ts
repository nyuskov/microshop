/**
 * Предупреждение «собеседник сменил ключ шифрования».
 *
 * Проверяем, что диалог объясняет ситуацию по-человечески (называет собеседника
 * и не пугает зря) и что основная кнопка подтверждает новый ключ — иначе после
 * проверки ключа предупреждение всплывало бы при каждом входе.
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
        'q-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' }
      }
    }
  })

describe('PeerKeyChangedDialog', () => {
  it('называет собеседника и объясняет, что бывает и хорошо, и плохо', () => {
    const text = mountDialog('Аня').text()
    expect(text).toContain('Аня')
    expect(text).toContain('другой ключ сквозного шифрования')
    expect(text).toContain('сможет читать')
    expect(text).toContain('не отправляйте')
  })

  it('без имени собеседника текст остаётся понятным', () => {
    const text = mountDialog().text()
    expect(text).toContain('У собеседника')
  })

  it('подтверждение нового ключа закрывает диалог и сообщает об этом наружу', async () => {
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

  it('«Закрыть» не подтверждает ключ (спросим в следующий раз)', async () => {
    const wrapper = mountDialog('Аня')
    await wrapper.findAll('.pk-actions button')[1].trigger('click')

    expect(wrapper.emitted('accept')).toBeUndefined()
  })
})
