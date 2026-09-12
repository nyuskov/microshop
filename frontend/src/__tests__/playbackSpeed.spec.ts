import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import AudioMessage from '@/components/media/AudioMessage.vue'
import {
  cyclePlaybackSpeed,
  nextPlaybackSpeed,
  playbackSpeed,
  PLAYBACK_SPEEDS,
  speedLabel
} from '@/utils/playbackSpeed'

/**
 * Скорость воспроизведения голосовых и видеосообщений.
 *
 * Логика выбора — общая на всё приложение (см. `utils/playbackSpeed`), а сам
 * плеер должен ставить её на элемент `<audio>`: без этого кнопка меняла бы
 * подпись, но звук играл бы с обычной скоростью.
 */
describe('playbackSpeed', () => {
  beforeEach(() => {
    playbackSpeed.value = 1
  })

  it('переключает скорости по кругу', () => {
    expect(nextPlaybackSpeed(1)).toBe(1.5)
    expect(nextPlaybackSpeed(1.5)).toBe(2)
    expect(nextPlaybackSpeed(2)).toBe(1)
    expect(cyclePlaybackSpeed()).toBe(1.5)
    expect(cyclePlaybackSpeed()).toBe(2)
    expect(cyclePlaybackSpeed()).toBe(1)
  })

  it('подпись скорости — как в интерфейсе', () => {
    expect(PLAYBACK_SPEEDS.map(speedLabel)).toEqual(['1×', '1.5×', '2×'])
  })
})

describe('AudioMessage: скорость', () => {
  beforeEach(() => {
    playbackSpeed.value = 1
  })

  it('кнопка меняет скорость элемента и общую настройку', async () => {
    const wrapper = mount(AudioMessage, {
      props: { src: '/media/voice.webm', name: 'voice.webm', size: 1024 },
      // q-icon подключается приложением целиком; в тесте достаточно заглушки.
      global: { stubs: { 'q-icon': true } }
    })
    const audio = wrapper.find('audio').element as HTMLAudioElement

    expect(wrapper.find('.am-speed').text()).toBe('1×')

    await wrapper.find('.am-speed').trigger('click')
    expect(playbackSpeed.value).toBe(1.5)
    expect(audio.playbackRate).toBe(1.5)
    expect(wrapper.find('.am-speed').text()).toBe('1.5×')

    await wrapper.find('.am-speed').trigger('click')
    expect(audio.playbackRate).toBe(2)
    expect(wrapper.find('.am-speed').text()).toBe('2×')

    await wrapper.find('.am-speed').trigger('click')
    expect(audio.playbackRate).toBe(1)
    expect(wrapper.find('.am-speed').text()).toBe('1×')
  })

  it('выбор скорости одного сообщения действует на остальные', async () => {
    const first = mount(AudioMessage, {
      props: { src: '/media/a.webm', name: 'a.webm' },
      global: { stubs: { 'q-icon': true } }
    })
    const second = mount(AudioMessage, {
      props: { src: '/media/b.webm', name: 'b.webm' },
      global: { stubs: { 'q-icon': true } }
    })

    await first.find('.am-speed').trigger('click')
    await second.vm.$nextTick()

    const secondAudio = second.find('audio').element as HTMLAudioElement
    expect(secondAudio.playbackRate).toBe(1.5)
    expect(second.find('.am-speed').text()).toBe('1.5×')
  })
})
