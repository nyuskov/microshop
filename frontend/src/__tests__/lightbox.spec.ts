/**
 * Кадры лайтбокса собираются лениво.
 *
 * Главное, что проверяем: список строится по всей загруженной истории, но
 * расшифровку НЕ запускает (иначе открытие чата тянуло бы все изображения), и
 * при этом кадры без готовой ссылки из списка НЕ выпадают — раньше они
 * отбрасывались, из-за чего после каждой расшифровки список рос, а индексы и
 * «3 / 7» прыгали прямо во время просмотра.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildLightboxItems, neighborIndexes } from '@/utils/lightbox'
import { useLightbox } from '@/composables/useLightbox'
import { effectScope, nextTick, type EffectScope } from 'vue'
import type { Message } from '@/types'

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

/**
 * Состояние просмотра: на каком кадре открывается, листание по кругу,
 * закрытие и подготовка (расшифровка) текущего кадра с соседями.
 * Вынесено из `Messenger.vue` в `useLightbox`.
 */

const picture = (id: number, patch: Partial<Message> = {}): Message =>
  ({
    id,
    chat_id: 7,
    user_id: 1,
    text: '',
    file: { url: `/media/${id}.jpg`, name: `photo_${id}.jpg`, mime: 'image/jpeg', size: 10 },
    e2ee_file: null,
    ...patch
  }) as unknown as Message

describe('useLightbox', () => {
  let scope: EffectScope
  let messages: Message[]
  let prepared: number[]
  let opened: number
  let lightbox: ReturnType<typeof useLightbox>

  const setup = (initial: Message[]) => {
    messages = initial
    prepared = []
    opened = 0
    scope = effectScope()
    scope.run(() => {
      lightbox = useLightbox({
        messages: () => messages,
        urlOf: (message) => `/media/${message.id}.jpg`,
        needsPrepare: (message) => !!message.e2ee_file,
        prepare: (message) => prepared.push(message.id),
        onOpen: () => {
          opened += 1
        }
      })
    })
  }

  afterEach(() => scope.stop())

  it('открывается на выбранном кадре и отмечает слой в истории', () => {
    setup([picture(1), picture(3), picture(4)])

    lightbox.open(picture(3))

    expect(lightbox.index.value).toBe(1)
    expect(opened).toBe(1)
  })

  it('без изображений просмотр не открываем', () => {
    setup([{ id: 2, text: 'привет', file: null } as unknown as Message])

    lightbox.open(picture(2))

    expect(lightbox.index.value).toBeNull()
    expect(opened).toBe(0)
  })

  it('листание идёт по кругу в обе стороны', () => {
    setup([picture(1), picture(3), picture(4)])
    lightbox.open(picture(1))

    lightbox.step(-1)
    expect(lightbox.items.value[lightbox.index.value!]?.id).toBe(4)

    lightbox.step(1)
    expect(lightbox.items.value[lightbox.index.value!]?.id).toBe(1)
  })

  it('закрытие сбрасывает текущий кадр', () => {
    setup([picture(1)])
    lightbox.open(picture(1))

    lightbox.close()

    expect(lightbox.index.value).toBeNull()
  })

  it('расшифровку просит только для шифрованных кадров и только вокруг текущего', async () => {
    setup([
      picture(1, { e2ee_file: { n: 'a.jpg', m: 'image/jpeg', s: 10 } as never }),
      picture(3),
      picture(4)
    ])
    await nextTick()

    lightbox.open(picture(3))
    await nextTick()

    // Текущий кадр не шифрован, у соседа слева расшифровка просится,
    // обычный правый кадр — нет.
    expect(prepared).toEqual([1])
  })
})
