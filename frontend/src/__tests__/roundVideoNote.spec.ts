import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import RoundVideoMessage from '@/components/media/RoundVideoMessage.vue'

/**
 * Недоступная запись «кружка».
 *
 * Раньше состояние ошибки рисовалось оверлеем внутри круга `min(300px, 66vw)`:
 * сообщение занимало пол-экрана и содержало одну строку «Видео недоступно», а
 * фон под текстом был чёрным независимо от темы. Теперь это компактная плашка в
 * цветах темы, и она не должна притворяться кнопкой: играть нечего.
 */

const mountNote = () =>
  mount(RoundVideoMessage, {
    props: { src: '/media/missing.mp4', name: 'video.mp4' },
    // q-icon подключается приложением целиком; в тесте достаточно заглушки.
    global: { stubs: { 'q-icon': true } }
  })

// У компонента два корневых узла (кружок и Teleport для крупного просмотра),
// поэтому обращаемся к самому кружку, а не к wrapper.
const noteOf = (wrapper: ReturnType<typeof mountNote>) => wrapper.find('.round-video-msg')

describe('RoundVideoMessage: недоступная запись', () => {
  it('после ошибки видео показывает плашку и перестаёт быть кнопкой', async () => {
    const wrapper = mountNote()
    const note = noteOf(wrapper)

    expect(note.classes()).not.toContain('broken')
    expect(note.attributes('role')).toBe('button')
    expect(note.attributes('tabindex')).toBe('0')

    await wrapper.find('video').trigger('error')

    expect(note.classes()).toContain('broken')
    expect(wrapper.find('.rvm-error').exists()).toBe(true)
    expect(wrapper.find('.rvm-error').text()).toContain('Видео недоступно')
    // Не кнопка: играть нечего, клик и Enter ничего не делают.
    expect(note.attributes('role')).toBeUndefined()
    expect(note.attributes('tabindex')).toBeUndefined()
  })

  it('не предлагает плавающее окно и плеер для недоступной записи', async () => {
    const wrapper = mountNote()
    await wrapper.find('video').trigger('error')

    expect(wrapper.find('.rvm-pip').exists()).toBe(false)
    expect(wrapper.find('.rvm-expand').exists()).toBe(false)
    expect(wrapper.find('.rvm-center').exists()).toBe(false)
  })
})

describe('зеркало в видеосообщении', () => {
  const recorder = readFileSync('src/components/media/VideoRecorderModal.vue', 'utf8')

  it('зеркалит только предпросмотр, а в файл идёт поток как есть', () => {
    // Владелец: «кружок записываешь — смотришь одно, сохраняется зеркальным».
    // Так и должно быть: зеркальный вид при съёмке себя привычнее (как в зеркале),
    // но в записи он был бы неверным — надписи в кадре читались бы наоборот.
    expect(recorder).toContain(':class="{ mirrored: phase !== \'preview\' }"')
    expect(recorder).toContain('transform: scaleX(-1)')
    // Файл — прямо из MediaRecorder, без переворота через canvas.
    expect(recorder).toContain('blob = new Blob(chunks')
    expect(recorder).not.toContain('drawImage')
    expect(recorder).not.toContain("getContext('2d')")
  })

  it('человеку объяснено, почему предпросмотр зеркальный', () => {
    expect(recorder).toContain('Предпросмотр зеркальный — в записи будет как есть')
    expect(recorder).toContain('Так увидит собеседник')
  })
})
