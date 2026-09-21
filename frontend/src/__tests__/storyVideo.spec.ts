import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { probeVideoPlayback, VIDEO_PROBE_TIMEOUT_MS } from '@/utils/stories'

/**
 * Проверка видео перед публикацией истории.
 *
 * Повод: автор загрузил ролик с телефона в формате, который браузер не
 * декодирует (MPEG-4 Visual `mp4v` + звук AMR), открыл свою историю и увидел
 * чёрный экран. Такой файл нельзя перекодировать на клиенте — декодера у
 * браузера нет, — поэтому клиент честно проверяет файл и просит сервер
 * перекодировать его (см. `core/video_transcode.py`).
 *
 * Сам разбор медиа в jsdom не работает, поэтому элемент подменяется: тесты
 * проверяют решение (играет / не играет / не дождались) и уборку за собой, а
 * связка с публикацией и просмотром — статическими проверками исходников.
 */

/** Поддельный `<video>`: события и свойства, которые трогает проверка. */
class FakeVideo {
  listeners = new Map<string, Set<() => void>>()
  preload = ''
  muted = false
  src = ''

  addEventListener(type: string, handler: () => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(handler)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, handler: () => void): void {
    this.listeners.get(type)?.delete(handler)
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }

  emit(type: string): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler()
  }
}

const videoFile = () =>
  new File([new Uint8Array([0, 1, 2, 3])], '1000013648.mp4', { type: 'video/mp4' })

const asElement = (video: FakeVideo) => video as unknown as HTMLVideoElement

describe('проба видео перед публикацией', () => {
  it('первый кадр появился — видео играет', async () => {
    const video = new FakeVideo()
    const promise = probeVideoPlayback(videoFile(), { createVideo: () => asElement(video) })

    video.emit('loadeddata')

    await expect(promise).resolves.toBe('playable')
  })

  it('ошибка декодирования — видео не проигрывается', async () => {
    const video = new FakeVideo()
    const promise = probeVideoPlayback(videoFile(), { createVideo: () => asElement(video) })

    video.emit('error')

    await expect(promise).resolves.toBe('unsupported')
  })

  it('первого кадра так и не дождались — «неизвестно», а не «не играет»', async () => {
    vi.useFakeTimers()
    try {
      const video = new FakeVideo()
      const promise = probeVideoPlayback(videoFile(), { createVideo: () => asElement(video) })

      vi.advanceTimersByTime(VIDEO_PROBE_TIMEOUT_MS + 1)

      await expect(promise).resolves.toBe('unknown')
    } finally {
      vi.useRealTimers()
    }
  })

  it('за собой убирает: освобождает blob-ссылку и снимает src', async () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:проба', revokeObjectURL: revoke })
    try {
      const video = new FakeVideo()
      const promise = probeVideoPlayback(videoFile(), { createVideo: () => asElement(video) })

      expect(video.src).toBe('blob:проба')
      expect(video.muted).toBe(true)
      video.emit('error')

      await promise
      expect(revoke).toHaveBeenCalledWith('blob:проба')
      expect(video.src).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('связка проверки видео с публикацией и просмотром', () => {
  const strip = readFileSync('src/components/stories/StoriesStrip.vue', 'utf8')
  const viewer = readFileSync('src/components/stories/StoryViewer.vue', 'utf8')
  const store = readFileSync('src/stores/stories.ts', 'utf8')
  const service = readFileSync('src/services/stories.ts', 'utf8')

  it('полоса историй проверяет выбранное видео', () => {
    expect(strip).toContain('const probe = probeVideoPlayback(file)')
    expect(strip).toContain("videoNeedsTranscode.value = result === 'unsupported'")
  })

  it('непроигрываемое видео уходит с просьбой перекодировать', () => {
    expect(strip).toContain("transcode: result === 'unsupported'")
    expect(store).toContain('publishStory(file, caption, options)')
    expect(service).toContain('...(options.transcode ? { transcode: 1 } : {})')
    // Перекодирование идёт внутри запроса публикации, поэтому таймаут свой.
    expect(service).toContain('timeout: STORY_PUBLISH_TIMEOUT_MS')
  })

  it('просмотрщик объясняет сбой видео, а не оставляет чёрный экран', () => {
    expect(viewer).toContain('@error="onVideoError"')
    expect(viewer).toContain('class="viewer-failed"')
    expect(viewer).toContain('startImageTimer(VIDEO_FAIL_DURATION_MS)')
    // Плашка относится к конкретному файлу: при листании её не переносим.
    expect(viewer).toContain('videoFailed.value = false')
  })
})
