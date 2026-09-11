import { describe, expect, it } from 'vitest'
import { MAX_SHARE_FILE_BYTES, sharedFileName } from '@/services/nativeShare'

describe('sharedFileName', () => {
  it('оставляет нормальное имя как есть', () => {
    expect(sharedFileName('IMG_2024.jpg', 'image/jpeg')).toBe('IMG_2024.jpg')
    expect(sharedFileName('photo.webp', 'image/webp')).toBe('photo.webp')
  })

  it('дописывает расширение, если провайдер его не дал', () => {
    expect(sharedFileName('1000012345', 'image/jpeg')).toBe('1000012345.jpg')
    expect(sharedFileName('screenshot', 'image/png')).toBe('screenshot.png')
    expect(sharedFileName('', 'image/gif')).toBe('shared.gif')
  })

  it('берёт расширение из подтипа для картинок без своей записи в карте', () => {
    expect(sharedFileName('pic', 'image/bmp')).toBe('pic.bmp')
    expect(sharedFileName('pic', 'image/avif')).toBe('pic.avif')
  })

  it('лимит размера — 20 МБ (столько же, сколько в нативной части)', () => {
    expect(MAX_SHARE_FILE_BYTES).toBe(20 * 1024 * 1024)
  })
})
