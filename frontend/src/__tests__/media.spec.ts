import { describe, expect, it } from 'vitest'

import type { Message, MessageFile } from '@/types'
import {
  fileIcon,
  isImageFile,
  isRecordedVideoMessage,
  mediaKindOf,
  messageSnippet
} from '@/utils/media'

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
  forwarded_from: null,
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
  it('подбирает Material-иконку по mime', () => {
    expect(fileIcon(makeFile({ mime: 'image/png' }))).toBe('image')
    expect(fileIcon(makeFile({ mime: 'video/mp4' }))).toBe('videocam')
    expect(fileIcon(makeFile({ mime: 'application/pdf' }))).toBe('picture_as_pdf')
    expect(fileIcon(makeFile({ mime: 'audio/mpeg' }))).toBe('volume_up')
    expect(fileIcon(makeFile({ mime: 'text/plain' }))).toBe('description')
    expect(fileIcon(makeFile({ mime: 'application/zip' }))).toBe('insert_drive_file')
  })
})

describe('mediaKindOf', () => {
  it('тип определяет mime, если он есть', () => {
    expect(mediaKindOf({ mime: 'image/png', name: 'photo.bin' })).toBe('image')
    expect(mediaKindOf({ mime: 'video/mp4', name: 'clip.bin' })).toBe('video')
    // Голосовое: расширение .webm то же, что у видео — решает mime.
    expect(mediaKindOf({ mime: 'audio/webm', name: 'voice.webm' })).toBe('audio')
  })

  it('без mime тип берётся из расширения (как на сервере)', () => {
    expect(mediaKindOf({ mime: null, name: 'photo.png' })).toBe('image')
    expect(mediaKindOf({ mime: null, name: 'clip.mp4' })).toBe('video')
    expect(mediaKindOf({ mime: null, name: 'doc.txt' })).toBe('file')
    expect(mediaKindOf({ mime: null, name: 'archive' })).toBe('file')
    expect(mediaKindOf({})).toBe('file')
  })
})
