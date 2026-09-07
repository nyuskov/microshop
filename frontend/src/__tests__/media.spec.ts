import { describe, expect, it } from 'vitest'

import type { Message, MessageFile } from '@/types'
import { fileIcon, isImageFile, isRecordedVideoMessage, messageSnippet } from '@/utils/media'

const makeFile = (overrides: Partial<MessageFile>): MessageFile => ({
  name: 'file.bin',
  url: '/media/x',
  mime: null,
  size: 10,
  ...overrides
})

const makeMessage = (overrides: Partial<Message>): Message => ({
  id: 1,
  chat_id: 1,
  user_id: 1,
  text: '',
  timestamp: '2026-09-07T10:00:00Z',
  reply_to_id: null,
  is_read: true,
  is_pinned: false,
  edited_at: null,
  file: null,
  reactions: [],
  ...overrides
})

describe('messageSnippet', () => {
  it('возвращает текст сообщения', () => {
    expect(messageSnippet(makeMessage({ text: 'Привет' }))).toBe('Привет')
  })

  it('описывает изображение, аудио, видео и прочий файл', () => {
    expect(
      messageSnippet(makeMessage({ file: makeFile({ mime: 'image/png', name: 'a.png' }) }))
    ).toBe('📷 Изображение')
    expect(
      messageSnippet(makeMessage({ file: makeFile({ mime: 'audio/ogg', name: 'a.ogg' }) }))
    ).toBe('🎤 Голосовое')
    expect(
      messageSnippet(makeMessage({ file: makeFile({ mime: 'video/mp4', name: 'a.mp4' }) }))
    ).toBe('🎥 Видео')
    expect(
      messageSnippet(makeMessage({ file: makeFile({ mime: 'application/pdf', name: 'a.pdf' }) }))
    ).toBe('📎 a.pdf')
  })
})

describe('isImageFile / isRecordedVideoMessage', () => {
  it('определяет изображение по mime и корректно обрабатывает null', () => {
    expect(isImageFile(makeFile({ mime: 'image/jpeg' }))).toBe(true)
    expect(isImageFile(makeFile({ mime: 'text/plain' }))).toBe(false)
    expect(isImageFile(makeFile({ mime: null }))).toBe(false)
  })

  it('распознаёт «кружок-видео» только для файлов video_*', () => {
    expect(isRecordedVideoMessage(makeFile({ mime: 'video/mp4', name: 'video_123.mp4' }))).toBe(
      true
    )
    expect(isRecordedVideoMessage(makeFile({ mime: 'video/mp4', name: 'rec.mp4' }))).toBe(false)
  })
})

describe('fileIcon', () => {
  it('подбирает иконку по mime', () => {
    expect(fileIcon(makeFile({ mime: 'image/png' }))).toBe('pi pi-image')
    expect(fileIcon(makeFile({ mime: 'video/mp4' }))).toBe('pi pi-video')
    expect(fileIcon(makeFile({ mime: 'application/pdf' }))).toBe('pi pi-file-pdf')
    expect(fileIcon(makeFile({ mime: 'audio/mpeg' }))).toBe('pi pi-volume-up')
    expect(fileIcon(makeFile({ mime: 'text/plain' }))).toBe('pi pi-file')
    expect(fileIcon(makeFile({ mime: 'application/zip' }))).toBe('pi pi-file')
  })
})
