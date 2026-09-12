/**
 * Кадры лайтбокса собираются лениво.
 *
 * Главное, что проверяем: список строится по всей загруженной истории, но
 * расшифровку НЕ запускает (иначе открытие чата тянуло бы все изображения), и
 * при этом кадры без готовой ссылки из списка НЕ выпадают — раньше они
 * отбрасывались, из-за чего после каждой расшифровки список рос, а индексы и
 * «3 / 7» прыгали прямо во время просмотра.
 */

import { describe, expect, it, vi } from 'vitest'

import { buildLightboxItems, neighborIndexes } from '@/utils/lightbox'

const imageMessage = (id: number, name = `photo_${id}.jpg`) =>
  ({
    id,
    file: { url: `/media/${id}.jpg`, name, mime: 'image/jpeg', size: 10 },
    e2ee_file: null
  }) as never

/** Зашифрованное изображение: на сервере лежит шифротекст, имя — в конверте. */
const e2eeImage = (id: number) =>
  ({
    id,
    file: {
      url: `/media/enc_${id}.bin`,
      name: 'enc.bin',
      mime: 'application/octet-stream',
      size: 10
    },
    e2ee_file: { n: 'secret.jpg', m: 'image/jpeg', s: 10 }
  }) as never

const textMessage = (id: number) => ({ id, text: 'привет', file: null, e2ee_file: null }) as never

describe('buildLightboxItems', () => {
  it('берёт только изображения и сохраняет порядок ленты', () => {
    const items = buildLightboxItems(
      [imageMessage(1), textMessage(2), e2eeImage(3), imageMessage(4)],
      (message) => `url-${message.id}`
    )

    expect(items.map((item) => item.id)).toEqual([1, 3, 4])
    expect(items.map((item) => item.url)).toEqual(['url-1', 'url-3', 'url-4'])
  })

  it('не расшифровывает кадры: ссылку спрашивает ровно один раз на изображение', () => {
    const resolveUrl = vi.fn(() => '')

    buildLightboxItems([imageMessage(1), e2eeImage(2), textMessage(3)], resolveUrl)

    expect(resolveUrl).toHaveBeenCalledTimes(2)
  })

  it('оставляет в списке кадр без готовой ссылки (ленивая расшифровка)', () => {
    const items = buildLightboxItems([e2eeImage(1), e2eeImage(2)], () => '')

    expect(items).toHaveLength(2)
    expect(items[0]?.url).toBe('')
    expect(items[0]?.message.id).toBe(1)
  })

  it('подставляет имя из конверта, а без имени — запасное', () => {
    const items = buildLightboxItems([e2eeImage(1), imageMessage(2, '')], () => 'x')

    expect(items[0]?.name).toBe('secret.jpg')
    expect(items[1]?.name).toBe('Изображение')
  })
})

describe('neighborIndexes', () => {
  it('возвращает текущий кадр и соседей по кругу', () => {
    expect(neighborIndexes(0, 4)).toEqual([0, 3, 1])
    expect(neighborIndexes(3, 4)).toEqual([3, 2, 0])
  })

  it('для единственного кадра и пустого списка не выдумывает соседей', () => {
    expect(neighborIndexes(0, 1)).toEqual([0])
    expect(neighborIndexes(0, 0)).toEqual([])
  })
})
