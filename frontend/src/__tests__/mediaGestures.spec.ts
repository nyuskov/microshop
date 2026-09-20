import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import ImageLightbox from '@/components/media/ImageLightbox.vue'
import AudioMessage from '@/components/media/AudioMessage.vue'

/**
 * Жесты в медиа: просмотр фото и перемотка голосового.
 *
 * Оба жеста ловились живьём и оба дали по грабле (см. комментарии в
 * компонентах): у перемотки живой прямоугольник полосы «уезжал» во время
 * движения, а `setPointerCapture` бросал исключение и через
 * `app.config.errorHandler` показывал фатальный экран вместо перемотки.
 */

const IMAGES = [
  { id: 1, url: '/a.jpg', name: 'a.jpg' },
  { id: 2, url: '/b.jpg', name: 'b.jpg' },
  { id: 3, url: '/c.jpg', name: 'c.jpg' }
]

/** В jsdom нет PointerEvent: берём мышиное событие и дописываем поля указателя. */
const pointer = (type: string, x: number, y: number): Event => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  Object.defineProperty(event, 'isPrimary', { value: true })
  return event
}

const mountLightbox = (index = 0, images = IMAGES) =>
  mount(ImageLightbox, {
    props: { images, index },
    global: { stubs: { 'q-icon': true, BrandSpinner: true } },
    attachTo: document.body
  })

// Разметка лайтбокса телепортирована в `body` — искать её надо в документе.
const overlayEl = (): HTMLElement => document.querySelector('.lb-overlay') as HTMLElement
const imageStyle = (): string =>
  (document.querySelector('.lb-image') as HTMLElement | null)?.getAttribute('style') ?? ''

const swipe = async (
  wrapper: ReturnType<typeof mountLightbox>,
  from: [number, number],
  to: [number, number]
) => {
  const overlay = overlayEl()
  overlay.dispatchEvent(pointer('pointerdown', from[0], from[1]))
  overlay.dispatchEvent(pointer('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2))
  await nextTick()
  overlay.dispatchEvent(pointer('pointermove', to[0], to[1]))
  await nextTick()
  overlay.dispatchEvent(pointer('pointerup', to[0], to[1]))
  await nextTick()
  void wrapper
}

describe('просмотр фото: жесты', () => {
  it('свайп влево листает вперёд, вправо — назад', async () => {
    const wrapper = mountLightbox()
    await swipe(wrapper, [300, 400], [180, 400])
    expect(wrapper.emitted('next')).toHaveLength(1)
    wrapper.unmount()

    const back = mountLightbox(1)
    await swipe(back, [180, 400], [300, 400])
    expect(back.emitted('prev')).toHaveLength(1)
    back.unmount()
  })

  it('кадр едет за пальцем, а после отпускания возвращается', async () => {
    const wrapper = mountLightbox(1)
    const overlay = overlayEl()
    overlay.dispatchEvent(pointer('pointerdown', 300, 400))
    overlay.dispatchEvent(pointer('pointermove', 240, 400))
    await nextTick()
    expect(imageStyle()).toContain('translate(-60px')
    overlay.dispatchEvent(pointer('pointerup', 240, 400))
    await nextTick()
    // Сдвиг сброшен: следующий кадр откроется на месте.
    expect(imageStyle()).toContain('transform: none')
    wrapper.unmount()
  })

  it('свайп вниз закрывает просмотр, короткий — нет', async () => {
    const wrapper = mountLightbox()
    await swipe(wrapper, [200, 300], [200, 380])
    expect(wrapper.emitted('close')).toBeUndefined()
    await swipe(wrapper, [200, 300], [200, 460])
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('двойной тап увеличивает кадр, второй — возвращает', async () => {
    const wrapper = mountLightbox()
    const overlay = overlayEl()
    // jsdom layout не считает: без размеров кадра зум не начинается (в компоненте
    // это защита от ещё не загруженной картинки).
    const image = document.querySelector('.lb-image') as HTMLElement
    image.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as DOMRect
    const tap = () => {
      overlay.dispatchEvent(pointer('pointerdown', 200, 300))
      overlay.dispatchEvent(pointer('pointerup', 200, 300))
    }
    tap()
    await nextTick()
    expect(imageStyle()).not.toContain('scale(')
    tap()
    await nextTick()
    expect(imageStyle()).toContain('scale(2.5)')
    // Увеличиваем туда, куда попал палец: 200 из 400 по ширине — середина.
    expect(imageStyle()).toContain('transform-origin: 50%')
    tap()
    await nextTick()
    tap()
    await nextTick()
    expect(imageStyle()).not.toContain('scale(')
    wrapper.unmount()
  })

  it('одиночный кадр вбок не листается', async () => {
    const wrapper = mountLightbox(0, [IMAGES[0]!])
    await swipe(wrapper, [300, 400], [150, 400])
    expect(wrapper.emitted('next')).toBeUndefined()
    expect(wrapper.emitted('prev')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('перемотка голосового', () => {
  const mountAudio = async () => {
    const wrapper = mount(AudioMessage, {
      props: { messageId: 1, src: '/a.mp3', name: 'a.mp3', size: 1024 },
      global: { stubs: { 'q-icon': true } },
      attachTo: document.body
    })
    const audio = wrapper.get('audio').element as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 2 })
    await wrapper.get('audio').trigger('loadedmetadata')
    const track = wrapper.get('.am-track')
    // jsdom layout не считает: подставляем геометрию полосы руками.
    track.element.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 6 }) as DOMRect
    return { wrapper, audio, track }
  }

  it('протяжка двигает позицию, а плееру отдаём её при отпускании', async () => {
    const { wrapper, audio, track } = await mountAudio()
    track.element.dispatchEvent(pointer('pointerdown', 50, 3))
    await nextTick()
    expect(wrapper.get('.am-fill').attributes('style')).toContain('width: 25%')
    expect(audio.currentTime).toBe(0)

    track.element.dispatchEvent(pointer('pointermove', 150, 3))
    await nextTick()
    expect(wrapper.get('.am-fill').attributes('style')).toContain('width: 75%')

    track.element.dispatchEvent(pointer('pointerup', 150, 3))
    expect(audio.currentTime).toBeCloseTo(1.5)
  })

  it('палец за пределами полосы не уводит позицию дальше краёв', async () => {
    const { wrapper, track } = await mountAudio()
    track.element.dispatchEvent(pointer('pointerdown', 50, 3))
    track.element.dispatchEvent(pointer('pointermove', -80, 3))
    await nextTick()
    expect(wrapper.get('.am-fill').attributes('style')).toContain('width: 0%')
    track.element.dispatchEvent(pointer('pointermove', 400, 3))
    await nextTick()
    expect(wrapper.get('.am-fill').attributes('style')).toContain('width: 100%')
  })

  it('без известной длительности жест не начинается', async () => {
    const wrapper = mount(AudioMessage, {
      props: { messageId: 2, src: '/b.mp3', name: 'b.mp3' },
      global: { stubs: { 'q-icon': true } }
    })
    const track = wrapper.get('.am-track')
    track.element.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 6 }) as DOMRect
    track.element.dispatchEvent(pointer('pointerdown', 100, 3))
    await nextTick()
    expect(wrapper.get('.am-fill').attributes('style')).toContain('width: 0%')
  })
})
