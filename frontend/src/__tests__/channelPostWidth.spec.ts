import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageRow from '@/components/messenger/MessageRow.vue'
import MessageAttachment from '@/components/messenger/MessageAttachment.vue'
import type { Message } from '@/types'

/**
 * Пост канала занимает ВСЮ ширину ленты.
 *
 * В чате пузырь ограничен 60% (вторая сторона — собеседник), а в канале делить
 * ширину не с кем: раньше и здесь всё висело в узкой левой колонке. Правило
 * живёт на пропе `channel` (лента отдаёт его из `channelPosts`), он же рисует
 * свои посты как содержимое канала — слева и без галочек прочтения.
 *
 * Медиа в канале растёт вместе с пузырём (`wide` у вложения), но у «эмоций» —
 * стикеров и кружка — остаются свои размеры: растягивать их во всю ширину
 * незачем, а прозрачный пузырь во всю ширину увёл бы время от картинки.
 */
const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
const attachment = readFileSync('src/components/messenger/MessageAttachment.vue', 'utf8')
const thread = readFileSync('src/components/messenger/MessageThread.vue', 'utf8')

const messageWith = (extra: Partial<Message> = {}): Message =>
  ({
    id: 1,
    chat_id: 1,
    user_id: 1,
    text: 'пост канала',
    timestamp: '2026-09-21T00:00:00Z',
    reply_to_id: null,
    is_read: true,
    is_pinned: false,
    edited_at: null,
    file: null,
    reactions: [],
    forwarded_from: null,
    ...extra
  }) as unknown as Message

const mountRow = (extra: Record<string, unknown> = {}) =>
  mount(MessageRow, {
    props: {
      message: messageWith(),
      isOwn: true,
      viewerId: 1,
      highlighted: false,
      emojiPickerOpen: false,
      quote: null,
      selectionMode: false,
      selected: false,
      selectable: true,
      ...extra
    },
    global: { stubs: { 'q-icon': true } }
  })

const chartImage = messageWith({
  file: { name: 'photo.png', url: '/media/abc.png', mime: 'image/png', size: 1024 }
})

const mountAttachment = (extra: Record<string, unknown> = {}) =>
  mount(MessageAttachment, {
    props: { message: chartImage, rowVisible: true, ...extra },
    global: { stubs: { 'q-icon': true } }
  })

describe('пост канала во всю ширину', () => {
  it('строка канала помечена классом, а в чате — нет', () => {
    const channel = mountRow({ channel: true })
    expect(channel.find('.msg').classes()).toContain('channel')
    channel.unmount()

    const chat = mountRow()
    expect(chat.find('.msg').classes()).not.toContain('channel')
    chat.unmount()
  })

  it('строка и пузырь в канале растягиваются на всю ширину', () => {
    const channelRule = row.slice(row.indexOf('.msg.channel {'))
    const body = channelRule.slice(channelRule.indexOf('{'), channelRule.indexOf('}'))
    expect(body).toContain('max-width: 100%')
    expect(body).toContain('width: 100%')

    // Прозрачные пузыри стикеров и кружка исключены: у них нет фона и время
    // уехало бы от картинки в другой край экрана.
    expect(row).toContain('.msg.channel .msg-bubble:not(.sticker-only)')
    expect(row).toContain(':not(.sticker-image)')
    expect(row).toContain(':not(.round-video-only)')
  })

  it('свои посты в канале идут как содержимое канала: слева и без галочек', () => {
    const channel = mountRow({ channel: true, isOwn: true })
    expect(channel.find('.msg').classes()).toContain('in')
    expect(channel.find('.msg-ticks').exists()).toBe(false)
    channel.unmount()

    const chat = mountRow({ isOwn: true })
    expect(chat.find('.msg').classes()).toContain('out')
    expect(chat.find('.msg-ticks').exists()).toBe(true)
    chat.unmount()
  })

  it('лента отдаёт строке признак канала', () => {
    expect(thread).toContain(':channel="Boolean(channelPosts)"')
    expect(row).toContain(':wide="props.channel"')
  })

  it('вложение в канале получает режим wide', () => {
    const wide = mountAttachment({ wide: true })
    expect(wide.find('.attachment-image').classes()).toContain('wide')
    expect(wide.find('.attachment-image-btn').classes()).toContain('wide')
    wide.unmount()

    const chat = mountAttachment()
    expect(chat.find('.attachment-image').classes()).not.toContain('wide')
    chat.unmount()
  })

  it('кнопка картинки в канале тоже во всю ширину', () => {
    // Иначе процентный `max-width` у картинки разрешается в ширину самой кнопки,
    // а она «по содержимому» — замер на живом приложении дал картинке 0px.
    const rule = attachment.slice(attachment.indexOf('.attachment-image-btn.wide {'))
    const body = rule.slice(rule.indexOf('{'), rule.indexOf('}'))
    expect(body).toContain('width: 100%')

    const image = attachment.slice(attachment.indexOf('.attachment-image.wide'))
    const imageBody = image.slice(image.indexOf('{'), image.indexOf('}'))
    expect(imageBody).toContain('max-width: 100%')
    // Высота ограничена: вертикальное фото заняло бы весь экран.
    expect(imageBody).toContain('max-height:')
  })

  it('стикер в канале остаётся маленьким', () => {
    // У правила стикера специфичность выше (два класса + элемент против класса
    // + класса), поэтому квадратик 160px не растягивается вместе с пузырём.
    // Ищем по полному селектору: короткая строка встречается ещё в пояснении.
    const sticker = attachment.slice(
      attachment.indexOf('.attachment-image-btn.sticker .attachment-image {')
    )
    const body = sticker.slice(sticker.indexOf('{'), sticker.indexOf('}'))
    expect(body).toContain('max-width: 160px')
    expect(attachment.indexOf('.attachment-image.wide')).toBeLessThan(
      attachment.indexOf('.attachment-image-btn.sticker .attachment-image {')
    )
  })
})
