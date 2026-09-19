import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { Message } from '@/types'
import {
  ALBUM_MAX_ITEMS,
  albumLayout,
  isAlbumImage,
  newAlbumId,
  planFileSend
} from '@/utils/albums'
import type { MessageRow } from '@/utils/thread'

/**
 * Альбомы: несколько картинок одной отправки.
 *
 * Сервер хранит у таких сообщений общую метку `album_id`, а группировку рисует
 * клиент. Проверяем обе стороны договорённости: раскладку файлов на отправку и
 * сборку альбомов из ленты. Ошибки тут тихие — лента показала бы вместо сетки
 * «простыню» из картинок либо склеила бы разные отправки в один альбом.
 */

const file = (name: string, type: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type })

const image = (name: string): File => file(name, 'image/png')

const message = (over: Partial<Message> = {}): Message => ({
  id: 1,
  chat_id: 1,
  user_id: 1,
  text: '',
  timestamp: '2026-09-20T10:00:00+00:00',
  reply_to_id: null,
  is_read: true,
  is_pinned: false,
  edited_at: null,
  file: null,
  album_id: null,
  reactions: [],
  forwarded_from: null,
  ...over
})

const rows = (...messages: Message[]): MessageRow[] =>
  messages.map((item) => ({ kind: 'message', message: item }))

describe('раскладка файлов на отправку', () => {
  it('подряд идущие картинки уходят одним альбомом', () => {
    const plan = planFileSend([image('a.png'), image('b.png'), image('c.png')])

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ kind: 'album' })
    expect(plan[0]?.kind === 'album' && plan[0].files.map((f) => f.name)).toEqual([
      'a.png',
      'b.png',
      'c.png'
    ])
  })

  it('одна картинка альбомом не считается', () => {
    // Иначе в ленте появился бы «альбом из одного фото» — это просто картинка.
    const plan = planFileSend([image('a.png')])

    expect(plan).toEqual([{ kind: 'file', file: expect.any(File) }])
  })

  it('документ закрывает альбом и уходит своим сообщением', () => {
    const plan = planFileSend([
      image('a.png'),
      image('b.png'),
      file('doc.pdf', 'application/pdf'),
      image('c.png')
    ])

    expect(plan.map((item) => item.kind)).toEqual(['album', 'file', 'file'])
    expect(plan[0]?.kind === 'album' && plan[0].files).toHaveLength(2)
    expect(plan[1]?.kind === 'file' && plan[1].file.name).toBe('doc.pdf')
    expect(plan[2]?.kind === 'file' && plan[2].file.name).toBe('c.png')
  })

  it('длинную пачку режет на альбомы по пределу', () => {
    const files = Array.from({ length: ALBUM_MAX_ITEMS + 2 }, (_, i) => image(`p${i}.png`))
    const plan = planFileSend(files)

    expect(plan.map((item) => item.kind)).toEqual(['album', 'album'])
    expect(plan[0]?.kind === 'album' && plan[0].files).toHaveLength(ALBUM_MAX_ITEMS)
    expect(plan[1]?.kind === 'album' && plan[1].files).toHaveLength(2)
  })

  it('без альбомов («посмотреть один раз») всё уходит одиночными файлами', () => {
    // Одноразовое вложение и альбом несовместимы — сервер отвечает 400.
    const plan = planFileSend([image('a.png'), image('b.png')], false)

    expect(plan.map((item) => item.kind)).toEqual(['file', 'file'])
  })

  it('в альбом берём только картинки', () => {
    expect(isAlbumImage(image('a.png'))).toBe(true)
    expect(isAlbumImage(file('clip.mp4', 'video/mp4'))).toBe(false)
  })

  it('метка альбома уникальна', () => {
    expect(newAlbumId()).not.toBe(newAlbumId())
  })
})

describe('сборка альбомов из ленты', () => {
  it('сетку несёт первое сообщение пачки, остальные не рисуются', () => {
    const layout = albumLayout(
      rows(
        message({ id: 10, album_id: 'a1' }),
        message({ id: 11, album_id: 'a1' }),
        message({ id: 12, album_id: 'a1' })
      )
    )

    expect(layout.members.get(10)?.map((item) => item.id)).toEqual([10, 11, 12])
    expect(layout.continuations.has(11)).toBe(true)
    expect(layout.continuations.has(12)).toBe(true)
    expect(layout.continuations.has(10)).toBe(false)
    expect(layout.headOf.get(12)).toBe(10)
  })

  it('разные метки — разные альбомы', () => {
    const layout = albumLayout(
      rows(
        message({ id: 10, album_id: 'a1' }),
        message({ id: 11, album_id: 'a1' }),
        message({ id: 12, album_id: 'a2' }),
        message({ id: 13, album_id: 'a2' })
      )
    )

    expect(layout.members.get(10)?.map((item) => item.id)).toEqual([10, 11])
    expect(layout.members.get(12)?.map((item) => item.id)).toEqual([12, 13])
  })

  it('вклинившееся сообщение начинает альбом заново', () => {
    // Метка одна, но автор разный: склеивать такие сообщения в одну сетку нельзя.
    const layout = albumLayout(
      rows(
        message({ id: 10, album_id: 'a1' }),
        message({ id: 11, album_id: 'a1', user_id: 2 }),
        message({ id: 12, album_id: 'a1' })
      )
    )

    expect(layout.members.get(10)?.map((item) => item.id)).toEqual([10])
    expect(layout.members.get(11)?.map((item) => item.id)).toEqual([11])
    expect(layout.members.get(12)?.map((item) => item.id)).toEqual([12])
    expect(layout.continuations.size).toBe(0)
  })

  it('обычные сообщения остаются одиночными строками', () => {
    const layout = albumLayout(rows(message({ id: 10 }), message({ id: 11 })))

    expect(layout.members.size).toBe(0)
    expect(layout.continuations.size).toBe(0)
    expect(layout.headOf.get(11)).toBe(11)
  })

  it('голова альбома может быть удалена — части просто становятся новой пачкой', () => {
    // «Удалить у меня» у головного сообщения не должно прятать остальные.
    const layout = albumLayout(
      rows(message({ id: 11, album_id: 'a1' }), message({ id: 12, album_id: 'a1' }))
    )

    expect(layout.members.get(11)?.map((item) => item.id)).toEqual([11, 12])
  })
})

describe('альбом в разметке ленты', () => {
  const read = (path: string): string => readFileSync(path, 'utf8')

  it('лента не рисует продолжения пачки', () => {
    const thread = read('src/components/messenger/MessageThread.vue')
    expect(thread).toContain('albumLayout(props.rows)')
    expect(thread).toContain('albums.value.continuations.has(row.message.id)')
    expect(thread).toContain(':album="albumOf(item.row.message)"')
  })

  it('тап по плитке открывает именно её картинку', () => {
    // Иначе все плитки открывали бы первое фото альбома — так уже было с
    // лайтбоксом, когда событие теряло сообщение.
    const attachment = read('src/components/messenger/MessageAttachment.vue')
    const row = read('src/components/messenger/MessageRow.vue')
    const thread = read('src/components/messenger/MessageThread.vue')
    expect(attachment).toContain('@click.stop="emit(\'open-image\', tile.message)"')
    expect(row).toContain("emit('open-image', $event)")
    expect(thread).toContain('openImageOf(item.row, $event)')
    expect(thread).toContain("emit('open-image', message ?? row.message)")
  })

  it('подпись и «ответ» забирает первое вложение пачки', () => {
    const messenger = read('src/views/Messenger.vue')
    expect(messenger).toContain('planFileSend(files, !viewOnce)')
    expect(messenger).toContain('newAlbumId()')
    expect(messenger).toContain('caption: partCaption')
    expect(messenger).toContain('const partCaption = index === 0 ? captionLeft : null')
    // Список чатов и закреплённые перечитываются один раз на всю пачку.
    expect(messenger).toContain('if (options.refresh !== false)')
  })

  it('пачку можно выбрать и кнопкой «Прикрепить», а не только перетаскиванием', () => {
    // Без `multiple` альбом был бы доступен лишь мышью на компьютере: на телефоне
    // системный выборщик отдаёт по одному файлу.
    const composer = read('src/components/messenger/MessageComposer.vue')
    expect(composer).toContain('multiple')
    expect(composer).toContain("emit('files-selected', files, viewOnce)")
    const messenger = read('src/views/Messenger.vue')
    expect(messenger).toContain('@files-selected="onFilesSelected"')
  })
})
