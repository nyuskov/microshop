/**
 * Волна голосового сообщения (реальная громкость из файла).
 *
 * Владелец: «обозначение аудиозаписи сделай как фонограф, чтобы сила звука была
 * реальной». Проверяем три вещи: без WebAudio волна не считается и плеер остаётся
 * с прежней плоской полосой; посчитанная волна рисуется столбиками; проигранная
 * часть столбиков подсвечена по позиции.
 */
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AudioMessage from '@/components/media/AudioMessage.vue'
import { resetWaveformCache } from '@/utils/waveform'

const peaksMock = vi.fn<(messageId: number, src: string) => Promise<number[] | null>>()

vi.mock('@/utils/waveform', () => ({
  WAVE_BARS: 36,
  resetWaveformCache: vi.fn(),
  waveformPeaks: (messageId: number, src: string) => peaksMock(messageId, src)
}))

/** Одинаковая волна: пики 0, 0.25, 0.5, 0.75, 1 — по кругу. */
const flatWave = (): number[] => Array.from({ length: 40 }, (_, i) => (i % 5) / 4)

/** В jsdom нет PointerEvent: берём мышиное событие и дописываем поля указателя. */
const pointer = (type: string, x: number, y = 3): Event => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  Object.defineProperty(event, 'isPrimary', { value: true })
  return event
}

const mountAudio = async (messageId = 1) => {
  const wrapper = mount(AudioMessage, {
    props: { messageId, src: '/a.mp3', name: 'a.mp3', size: 1024 },
    global: { stubs: { 'q-icon': true } },
    attachTo: document.body
  })
  await flushPromises()
  const audio = wrapper.get('audio').element as HTMLAudioElement
  Object.defineProperty(audio, 'duration', { configurable: true, value: 4 })
  await wrapper.get('audio').trigger('loadedmetadata')
  const track = wrapper.get('.am-track')
  // jsdom layout не считает: подставляем геометрию полосы руками.
  track.element.getBoundingClientRect = () =>
    ({ left: 0, width: 200, top: 0, height: 20 }) as DOMRect
  return { wrapper, audio, track }
}

beforeEach(() => {
  peaksMock.mockReset()
  peaksMock.mockResolvedValue(flatWave())
  resetWaveformCache()
})

describe('волна голосового', () => {
  it('рисует столбики вместо плоской полосы', async () => {
    const { wrapper } = await mountAudio()
    expect(peaksMock).toHaveBeenCalledWith(1, '/a.mp3')
    expect(wrapper.findAll('.am-bar')).toHaveLength(40)
    expect(wrapper.find('.am-fill').exists()).toBe(false)
    expect(wrapper.get('.am-track').classes()).toContain('am-track-wave')
  })

  it('высота столбика зависит от громкости: тише — ниже', async () => {
    const { wrapper } = await mountAudio(2)
    const heights = wrapper.findAll('.am-bar').map((bar) => {
      const match = /height:\s*(\d+(?:\.\d+)?)px/.exec(bar.attributes('style') ?? '')
      return match ? Number(match[1]) : -1
    })
    // Пики записи: 0, 0.25, 0.5, 0.75, 1 → 4 px у самого тихого и 18 px у самого громкого.
    expect(Math.min(...heights)).toBe(4)
    expect(Math.max(...heights)).toBe(18)
    expect(heights[0]).toBeLessThan(heights[4])
  })

  it('проигранные столбики подсвечены по позиции, а не целиком', async () => {
    const { wrapper, audio, track } = await mountAudio(3)
    expect(wrapper.findAll('.am-bar.played')).toHaveLength(0)

    // Середина записи: подсвечена ровно половина столбиков.
    track.element.dispatchEvent(pointer('pointerdown', 100))
    await flushPromises()
    expect(wrapper.findAll('.am-bar.played')).toHaveLength(20)
    expect(audio.currentTime).toBe(0)

    // Отпускание отдаёт позицию плееру — подсветка не съезжает.
    track.element.dispatchEvent(pointer('pointerup', 100))
    expect(audio.currentTime).toBeCloseTo(2)
    expect(wrapper.findAll('.am-bar.played')).toHaveLength(20)
  })

  it('без WebAudio остаётся прежняя плоская полоса и перемотка работает', async () => {
    peaksMock.mockResolvedValue(null)
    const { wrapper, audio, track } = await mountAudio(4)
    expect(wrapper.findAll('.am-bar')).toHaveLength(0)
    expect(wrapper.get('.am-fill').attributes('style')).toContain('width: 0%')

    track.element.dispatchEvent(pointer('pointerdown', 150))
    track.element.dispatchEvent(pointer('pointerup', 150))
    expect(audio.currentTime).toBeCloseTo(3)
  })
})
