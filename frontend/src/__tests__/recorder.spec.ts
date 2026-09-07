import { describe, expect, it } from 'vitest'

import { extensionFromMime, formatClock, mediaFileName, pickMimeType } from '../services/recorder'

describe('extensionFromMime', () => {
  it('определяет расширение по MIME', () => {
    expect(extensionFromMime('video/mp4')).toBe('mp4')
    expect(extensionFromMime('audio/ogg;codecs=opus')).toBe('ogg')
    expect(extensionFromMime('audio/webm;codecs=opus')).toBe('webm')
    expect(extensionFromMime('video/webm')).toBe('webm')
  })
})

describe('mediaFileName', () => {
  it('строит имя с префиксом, меткой времени и расширением', () => {
    expect(mediaFileName('voice', 'audio/webm', 123)).toBe('voice_123.webm')
    expect(mediaFileName('video', 'video/mp4', 42)).toBe('video_42.mp4')
  })
})

describe('formatClock', () => {
  it('форматирует секунды как m:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(600)).toBe('10:00')
  })

  it('не уходит в минус для отрицательных значений', () => {
    expect(formatClock(-10)).toBe('0:00')
  })
})

describe('pickMimeType', () => {
  it('возвращает валидный MIME для audio и video', () => {
    const audio = pickMimeType('audio')
    const video = pickMimeType('video')
    expect(audio.startsWith('audio/')).toBe(true)
    expect(video.startsWith('video/')).toBe(true)
  })
})
