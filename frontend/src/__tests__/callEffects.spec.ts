import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import CallEffectsDialog from '@/components/calls/CallEffectsDialog.vue'
import { useCallStore } from '@/stores/call'
import { DEFAULT_MASK_LAYOUT, VIDEO_EFFECTS, VIDEO_MASKS } from '@/utils/videoEffects'

/**
 * Окно эффектов видео.
 *
 * Проверяем поведение, а не картинку: выбор эффекта и маски идёт в стор звонка
 * сразу (обработка включается на ходу, подтверждать нечего), маска встаёт «на
 * голову» в понятной точке, размер меняется кнопками и не выходит за пределы, а
 * в браузере без `captureStream` окно честно говорит, что эффектов не будет.
 *
 * Сам конвейер (canvas → дорожка) юнит-тестом не проверить: в jsdom нет ни
 * canvas, ни видео. Он проверен на живом примере в браузере.
 */

const mountDialog = () => {
  setActivePinia(createPinia())
  const store = useCallStore()
  const wrapper = mount(CallEffectsDialog)
  return { store, wrapper }
}

describe('окно эффектов видео', () => {
  beforeEach(() => {
    // jsdom не умеет captureStream: подменяем, иначе окно покажет «недоступно».
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      value: () => ({ getVideoTracks: () => [] })
    })
  })

  it('перечисляет все эффекты и маски, по умолчанию — «без эффекта»', () => {
    const { store, wrapper } = mountDialog()

    expect(store.videoEffect).toBe('none')
    expect(store.videoMask).toBeNull()
    for (const preset of VIDEO_EFFECTS) expect(wrapper.text()).toContain(preset.title)
    for (const mask of VIDEO_MASKS) expect(wrapper.text()).toContain(mask.title)
    expect(wrapper.text()).toContain('Без маски')
  })

  it('выбор эффекта применяется сразу, повторный выбор ничего не ломает', async () => {
    const { store, wrapper } = mountDialog()
    const warm = wrapper.findAll('button').find((item) => item.text() === 'Тёплый')!

    await warm.trigger('click')
    expect(store.videoEffect).toBe('warm')
    // Активный чип виден и для скринридера, и глазами (класс).
    expect(warm.classes()).toContain('active')
    expect(warm.attributes('aria-checked')).toBe('true')

    await warm.trigger('click')
    expect(store.videoEffect).toBe('warm')
  })

  it('маска встаёт по центру головы, а «Без маски» её снимает', async () => {
    const { store, wrapper } = mountDialog()
    const cat = wrapper.findAll('button').find((item) => item.text() === 'Кошка')!

    await cat.trigger('click')
    expect(store.videoMask).toBe('cat')
    expect(store.videoMaskLayout).toEqual(DEFAULT_MASK_LAYOUT)
    // Подсказка про перетаскивание появляется только вместе с маской.
    expect(wrapper.text()).toContain('Потяните маску')

    const none = wrapper.findAll('button').find((item) => item.text() === 'Без маски')!
    await none.trigger('click')
    expect(store.videoMask).toBeNull()
    expect(wrapper.text()).not.toContain('Потяните маску')
  })

  it('размер маски меняется кнопками и не уходит за пределы', async () => {
    const { store, wrapper } = mountDialog()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === 'Собака')!
      .trigger('click')

    const bigger = wrapper
      .findAll('button')
      .find((item) => item.attributes('title') === 'Маска больше')!
    const smaller = wrapper
      .findAll('button')
      .find((item) => item.attributes('title') === 'Маска меньше')!
    const base = store.videoMaskLayout.scale

    await bigger.trigger('click')
    expect(store.videoMaskLayout.scale).toBeGreaterThan(base)

    // Дожимаем до предела: кнопка гаснет, значение не растёт бесконечно.
    for (let i = 0; i < 30; i += 1) await bigger.trigger('click')
    expect(store.videoMaskLayout.scale).toBeLessThanOrEqual(1.1)
    expect(bigger.attributes('disabled')).toBeDefined()

    for (let i = 0; i < 30; i += 1) await smaller.trigger('click')
    expect(store.videoMaskLayout.scale).toBeGreaterThanOrEqual(0.18)
    expect(smaller.attributes('disabled')).toBeDefined()
  })

  it('«Убрать все эффекты» возвращает исходный вид', async () => {
    const { store, wrapper } = mountDialog()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === 'Ч/б')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === 'Корона')!
      .trigger('click')

    await wrapper
      .findAll('button')
      .find((item) => item.text() === 'Убрать все эффекты')!
      .trigger('click')

    expect(store.videoEffect).toBe('none')
    expect(store.videoMask).toBeNull()
  })

  it('без поддержки в браузере окно объясняет причину, а не молчит', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      value: undefined
    })
    const { wrapper } = mountDialog()

    expect(wrapper.text()).toContain('недоступны')
    expect(wrapper.findAll('button').some((item) => item.text() === 'Тёплый')).toBe(false)
  })

  it('закрывается по кнопке и по тапу мимо окна', async () => {
    const { wrapper } = mountDialog()

    await wrapper.find('.ms-overlay-head .icon-btn').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.find('.fx-overlay').trigger('mousedown')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
