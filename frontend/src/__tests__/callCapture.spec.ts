/**
 * Захват медиа для звонка: «план Б» по форматам камеры, режимы микрофона и
 * настройки ICE.
 *
 * Проверяем то, что в браузере выглядит как «не удалось получить доступ к
 * камере» — то есть отказ от звонка, хотя разговаривать было можно.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acquireCameraStream,
  acquireLocalMedia,
  audioConstraints,
  loadIceConfiguration
} from '@/stores/call/media'

vi.mock('@/services/iceServers', () => ({
  fetchIceServers: vi.fn(async () => [{ urls: 'turn:example.org:3478' }])
}))

/** Ошибка браузера: формат камеры не подошёл (это переживаем). */
const overconstrained = () => {
  const error = new Error('формат не поддержан')
  error.name = 'OverconstrainedError'
  return error
}

/** Ошибка браузера: доступ запрещён (перебирать форматы бессмысленно). */
const denied = () => {
  const error = new Error('доступ запрещён')
  error.name = 'NotAllowedError'
  return error
}

const fakeTrack = (kind: 'audio' | 'video') =>
  ({ kind, stop: vi.fn(), enabled: true }) as unknown as MediaStreamTrack

const fakeStream = (kinds: Array<'audio' | 'video'>) => {
  const tracks = kinds.map(fakeTrack)
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video')
  } as unknown as MediaStream
}

let getUserMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  getUserMedia = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices: vi.fn(async () => []) }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('захват медиа с «планом Б»', () => {
  it('камера не умеет формат — пробуем проще, звонок остаётся видеозвонком', async () => {
    getUserMedia
      .mockRejectedValueOnce(overconstrained())
      .mockResolvedValueOnce(fakeStream(['audio', 'video']))

    const result = await acquireLocalMedia('video')

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(result.kind).toBe('video')
    expect(result.stream.getVideoTracks()).toHaveLength(1)
  })

  it('запрет доступа не перебираем: лишние диалоги не показываем', async () => {
    getUserMedia.mockRejectedValue(denied())

    await expect(acquireLocalMedia('video')).rejects.toThrow()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('камера недоступна — звонок продолжается без видео', async () => {
    // Три формата камеры не подошли, четвёртый запрос — только звук.
    getUserMedia
      .mockRejectedValueOnce(overconstrained())
      .mockRejectedValueOnce(overconstrained())
      .mockRejectedValueOnce(overconstrained())
      .mockResolvedValueOnce(fakeStream(['audio']))

    const result = await acquireLocalMedia('video')

    expect(result.kind).toBe('audio')
    expect(result.videoFailed).toBeTruthy()
    expect(result.stream.getAudioTracks()).toHaveLength(1)
  })

  it('в группе захват меньше: поток уходит каждому участнику', async () => {
    getUserMedia.mockResolvedValue(fakeStream(['audio', 'video']))

    await acquireLocalMedia('video', { group: true })

    const constraints = getUserMedia.mock.calls[0][0] as MediaStreamConstraints
    expect(constraints.video).toMatchObject({ width: { ideal: 480 }, height: { ideal: 360 } })
  })

  it('смена камеры тоже перебирает форматы', async () => {
    getUserMedia
      .mockRejectedValueOnce(overconstrained())
      .mockResolvedValueOnce(fakeStream(['video']))

    const stream = await acquireCameraStream('cam-1')

    expect(stream.getVideoTracks()).toHaveLength(1)
    const first = getUserMedia.mock.calls[0][0] as MediaStreamConstraints
    const second = getUserMedia.mock.calls[1][0] as MediaStreamConstraints
    // Устройство из настроек требуем только в первой попытке: если камеру
    // выдернули, лучше взять любую другую, чем остаться без картинки.
    expect(first.video).toMatchObject({ deviceId: { exact: 'cam-1' } })
    expect(second.video).not.toHaveProperty('deviceId')
  })
})

describe('обработка микрофона', () => {
  it('в режиме «чистый голос» шумодав включён, в «естественном» — нет', () => {
    expect(audioConstraints(undefined, 'clean').noiseSuppression).toBe(true)
    expect(audioConstraints(undefined, 'natural').noiseSuppression).toBe(false)
    // Автоуровень нужен в обоих режимах: без него тихий голос теряется.
    expect(audioConstraints(undefined, 'natural').autoGainControl).toBe(true)
  })

  it('выбранный микрофон уходит в констрейнты', () => {
    expect(audioConstraints('mic-2').deviceId).toEqual({ exact: 'mic-2' })
  })
})

describe('настройки ICE', () => {
  it('все потоки идут одним транспортом, RTCP мультиплексируется', async () => {
    const config = await loadIceConfiguration()

    expect(config.bundlePolicy).toBe('max-bundle')
    expect(config.rtcpMuxPolicy).toBe('require')
    expect(config.iceCandidatePoolSize).toBe(4)
  })
})
