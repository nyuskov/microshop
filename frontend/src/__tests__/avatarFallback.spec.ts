import { describe, expect, it, vi } from 'vitest'

import {
  avatarFallbackCandidates,
  handleAvatarError,
  installAvatarFallback
} from '@/utils/avatarFallback'

/**
 * Аватар без файла миниатюры не должен «пропадать».
 *
 * Ссылку на миниатюру отдаёт сервер (`avatar_thumb_url`), а файла может не быть
 * (так было на проде: миниатюры удалила очистка media). Тогда клиент обязан
 * попробовать оригинал — иначе вместо аватара пустое место.
 */
describe('avatarFallbackCandidates', () => {
  it('собирает оригинал по имени миниатюры', () => {
    expect(avatarFallbackCandidates('/media/avatars/user_5_ab12_t128.jpg')).toEqual([
      '/media/avatars/user_5_ab12.jpg',
      '/media/avatars/user_5_ab12.png',
      '/media/avatars/user_5_ab12.webp'
    ])
  })

  it('сохраняет префикс пути для аватаров групп', () => {
    expect(avatarFallbackCandidates('/media/avatars/chat_12_55_t128.png')[0]).toBe(
      '/media/avatars/chat_12_55.jpg'
    )
  })

  it('не трогает ссылку без суффикса миниатюры', () => {
    expect(avatarFallbackCandidates('/media/avatars/user_5_ab12.jpg')).toEqual([])
    expect(avatarFallbackCandidates('/media/20260919_photo.webp')).toEqual([])
    expect(avatarFallbackCandidates('')).toEqual([])
  })

  it('работает и со ссылками в другом формате записи суффикса', () => {
    expect(avatarFallbackCandidates('/media/avatars/u_t192.jpeg')[0]).toBe('/media/avatars/u.jpg')
  })
})

describe('handleAvatarError', () => {
  const imageWithSrc = (src: string): HTMLImageElement => {
    const img = document.createElement('img')
    img.src = src
    return img
  }

  it('первая ошибка подставляет оригинал и оставляет остальные попытки', () => {
    const img = imageWithSrc('/media/avatars/u_1_t128.jpg')

    handleAvatarError({ target: img } as unknown as Event)

    expect(img.getAttribute('src')).toBe('/media/avatars/u_1.jpg')
    expect(img.dataset.avatarLeft).toBe(
      JSON.stringify(['/media/avatars/u_1.png', '/media/avatars/u_1.webp'])
    )
  })

  it('перебирает расширения, пока не кончатся, потом убирает src', () => {
    const img = imageWithSrc('/media/avatars/u_1_t128.jpg')

    handleAvatarError({ target: img } as unknown as Event)
    expect(img.getAttribute('src')).toBe('/media/avatars/u_1.jpg')

    handleAvatarError({ target: img } as unknown as Event)
    expect(img.getAttribute('src')).toBe('/media/avatars/u_1.png')

    handleAvatarError({ target: img } as unknown as Event)
    expect(img.getAttribute('src')).toBe('/media/avatars/u_1.webp')

    handleAvatarError({ target: img } as unknown as Event)
    expect(img.hasAttribute('src')).toBe(false)
  })

  it('событие не с картинки игнорируется', () => {
    const div = document.createElement('div')

    handleAvatarError({ target: div } as unknown as Event)

    expect(div.hasAttribute('src')).toBe(false)
  })

  it('слушатель ловит ошибки картинок на фазе перехвата', () => {
    // `error` у элементов не всплывает: без capture подмена не сработала бы.
    const addEventListener = vi.spyOn(window, 'addEventListener')

    installAvatarFallback()

    expect(addEventListener).toHaveBeenCalledWith('error', handleAvatarError, true)
    addEventListener.mockRestore()
  })
})
