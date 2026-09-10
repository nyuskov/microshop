import { describe, expect, it } from 'vitest'
import { kindAfterScreenShare } from '@/utils/callMode'

describe('kindAfterScreenShare', () => {
  it('видеозвонок возвращается к видео (камера была включена)', () => {
    expect(kindAfterScreenShare('video')).toBe('video')
  })

  it('аудиозвонок остаётся аудио — камеру не включаем', () => {
    expect(kindAfterScreenShare('audio')).toBe('audio')
  })
})
