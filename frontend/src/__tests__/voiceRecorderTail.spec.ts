/**
 * Хвост голосового: запись не «обрывается в конце».
 *
 * Жалоба владельца (25.09.2026): «аудиозапись как будто бы обрывается в конце».
 * Сам файл целый (разбор контейнера: размер сегмента, Duration и последний блок
 * сходятся) — терялся хвост в момент остановки: Opus держит последние кадры в
 * буфере, и мгновенный `stop()` их не забирает. Поэтому кодировщик пишет куски по
 * ходу записи (`start(250)`), а сама остановка идёт с короткой паузой (180 мс).
 *
 * Тест держит оба правила: без них «стоп» снова станет мгновенным и хвост
 * потеряется.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import VoiceRecorderBar from '@/components/media/VoiceRecorderBar.vue'

/** Поддельный MediaRecorder: запоминает аргументы `start` и момент `stop`. */
const recorders: FakeRecorder[] = []

class FakeRecorder {
  static isTypeSupported = (): boolean => true
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  readonly mimeType = 'audio/webm'
  startedWithTimeslice: number | undefined
  stops = 0

  constructor(
    public readonly stream: unknown,
    public readonly options?: { mimeType?: string }
  ) {
    recorders.push(this)
  }

  start(timeslice?: number) {
    this.startedWithTimeslice = timeslice
    this.state = 'recording'
  }

  stop() {
    this.stops += 1
    if (this.state === 'inactive') return
    // Как в браузере: сначала последний кусок данных, потом onstop.
    this.ondataavailable?.({ data: new Blob(['tail'], { type: 'audio/webm' }) })
    this.state = 'inactive'
    this.onstop?.()
  }
}

/** Последний созданный кодировщик — тот, с которым работал компонент. */
const current = (): FakeRecorder | undefined => recorders[recorders.length - 1]

const fakeStream = { getTracks: () => [{ stop: vi.fn() }] }

const mountBar = async () => {
  const wrapper = mount(VoiceRecorderBar, {
    global: { stubs: { 'q-icon': true } },
    attachTo: document.body
  })
  await flushPromises()
  return wrapper
}

const stopButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((button) => button.attributes('title') === 'Остановить запись')

beforeEach(() => {
  vi.useFakeTimers()
  recorders.length = 0
  // jsdom не умеет blob-ссылки, а бар после остановки строит ссылку для плеера.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => 'blob:voice'
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => undefined
  })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream) }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (URL as unknown as Record<string, unknown>).createObjectURL
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL
})

describe('хвост голосового', () => {
  it('кодировщик пишет куски по ходу записи, а не только в конце', async () => {
    await mountBar()
    expect(current()?.startedWithTimeslice).toBe(250)
  })

  it('остановка идёт с паузой: хвост успевает попасть в файл', async () => {
    const wrapper = await mountBar()
    stopButton(wrapper)?.trigger('click')
    await flushPromises()

    // Сразу после нажатия кодировщик ещё работает — иначе хвост потерялся бы.
    expect(current()?.stops).toBe(0)

    vi.advanceTimersByTime(179)
    expect(current()?.stops).toBe(0)

    vi.advanceTimersByTime(1)
    expect(current()?.stops).toBe(1)

    // После остановки бар перешёл в предпросмотр.
    await flushPromises()
    expect(wrapper.find('.vr-play').exists()).toBe(true)
  })

  it('отмена записи останавливает кодировщик сразу — данные всё равно выбрасываем', async () => {
    const wrapper = await mountBar()
    const cancel = wrapper
      .findAll('button')
      .find((b) => b.attributes('title') === 'Отменить запись')
    cancel?.trigger('click')
    await flushPromises()
    expect(current()?.stops).toBe(1)
  })
})
