import { describe, expect, it, vi } from 'vitest'

import { ATTACHMENT_UPLOAD_TIMEOUT_MS } from '@/services/chatService'
import { uploadPercent, uploadStatusText } from '@/utils/upload'

describe('uploadPercent', () => {
  it('считает процент отправленных байт', () => {
    expect(uploadPercent(0, 200)).toBe(0)
    expect(uploadPercent(50, 200)).toBe(25)
    expect(uploadPercent(199, 200)).toBe(99)
    expect(uploadPercent(200, 200)).toBe(100)
  })

  it('округляет вниз: до конца загрузки 100% не показываем', () => {
    expect(uploadPercent(1999, 2000)).toBe(99)
    expect(uploadPercent(99, 100)).toBe(99)
  })

  it('не выходит за границы и терпит неизвестный размер', () => {
    expect(uploadPercent(300, 200)).toBe(100)
    expect(uploadPercent(10, 0)).toBeNull()
    expect(uploadPercent(10, NaN)).toBeNull()
    expect(uploadPercent(NaN, 100)).toBeNull()
  })
})

describe('uploadStatusText', () => {
  it('показывает процент, когда он известен', () => {
    expect(uploadStatusText(42)).toBe('Отправка… 42%')
    expect(uploadStatusText(0)).toBe('Отправка… 0%')
  })

  it('без прогресса пишет просто «Отправка…»', () => {
    expect(uploadStatusText(undefined)).toBe('Отправка…')
    expect(uploadStatusText(null)).toBe('Отправка…')
  })
})

describe('таймаут загрузки вложения', () => {
  it('заметно длиннее общего таймаута клиента (15 с)', () => {
    expect(ATTACHMENT_UPLOAD_TIMEOUT_MS).toBeGreaterThan(15_000)
  })
})

describe('sendAttachmentMessage: события прогресса', () => {
  it('сообщает проценты по мере загрузки и не падает без прогресса', async () => {
    type UploadEvent = { loaded: number; total?: number }
    type PostConfig = {
      onUploadProgress?: (event: UploadEvent) => void
      timeout?: number
      params?: Record<string, string | number>
    }
    const post = vi.fn(async (_url: string, _data: unknown, config: PostConfig) => {
      const onProgress = config?.onUploadProgress
      // Браузер присылает события по мере отправки байт.
      onProgress?.({ loaded: 0, total: 100 })
      onProgress?.({ loaded: 50, total: 100 })
      onProgress?.({ loaded: 100, total: 100 })
      return { data: { id: 1 } }
    })
    vi.doMock('@/services/api', () => ({ api: { post } }))
    vi.resetModules()

    const { sendAttachmentMessage } = await import('@/services/chatService')
    const percents: number[] = []
    const file = new File(['x'.repeat(10)], 'photo.png', { type: 'image/png' })

    await sendAttachmentMessage(1, file, 'подпись', 3, (percent) => percents.push(percent))

    expect(post).toHaveBeenCalledTimes(1)
    expect(percents).toEqual([0, 50, 100])
    const config = post.mock.calls[0]?.[2] as PostConfig
    expect(config.timeout).toBe(ATTACHMENT_UPLOAD_TIMEOUT_MS)
    expect(config.params).toEqual({
      chat_id: 1,
      filename: 'photo.png',
      caption: 'подпись',
      mime: 'image/png',
      reply_to_id: 3
    })
    vi.doUnmock('@/services/api')
    vi.resetModules()
  })
})
