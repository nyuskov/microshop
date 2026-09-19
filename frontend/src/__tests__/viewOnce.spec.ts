import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageAttachment from '@/components/messenger/MessageAttachment.vue'
import type { Message } from '@/types'

/**
 * Одноразовые медиа: «посмотреть один раз» (F1).
 *
 * Главное в этой функции — не показать содержимое раньше времени: сервер отдаёт
 * такой файл ровно один раз, поэтому превью, галерея или кнопка «Скачать» сожгли
 * бы вложение до просмотра. Проверяем и клиент (плашка вместо картинки), и
 * стражи разметки/сервиса.
 */
const attachment = readFileSync('src/components/messenger/MessageAttachment.vue', 'utf8')
const composer = readFileSync('src/components/messenger/MessageComposer.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
const service = readFileSync('src/services/chatService.ts', 'utf8')
const actionsBar = readFileSync('src/components/messenger/MessageActionsBar.vue', 'utf8')
const actionSheet = readFileSync('src/components/messenger/MessageActionSheet.vue', 'utf8')
const viewer = readFileSync('src/components/media/ViewOnceViewer.vue', 'utf8')

const messageWith = (extra: Partial<Message>): Message =>
  ({
    id: 1,
    chat_id: 1,
    user_id: 2,
    text: '',
    timestamp: '2026-09-18T00:00:00Z',
    reply_to_id: null,
    is_read: true,
    is_pinned: false,
    edited_at: null,
    reactions: [],
    forwarded_from: null,
    file: { name: 'sekret.png', url: '/media/abc.png', mime: 'image/png', size: 1024 },
    ...extra
  }) as unknown as Message

const mountAttachment = (message: Message) =>
  mount(MessageAttachment, {
    props: { message, rowVisible: true },
    global: { stubs: { 'q-icon': true } }
  })

describe('плашка одноразового вложения', () => {
  it('плашка живёт в разметке вложения и просит открытие', () => {
    expect(attachment).toContain('attachment-view-once')
    expect(attachment).toContain("emit('open-view-once')")
    // Содержимое не грузим до нажатия: ссылка на файл остаётся только в данных.
    expect(attachment).toContain("viewOnceOpened ? 'Просмотрено' : viewOnceLabel")
  })

  it('вместо картинки показывает «открыть», а не превью', () => {
    const wrapper = mountAttachment(messageWith({ view_once: true }))

    expect(wrapper.find('.attachment-view-once').exists()).toBe(true)
    expect(wrapper.text()).toContain('Одноразовое фото')
    expect(wrapper.text()).toContain('Сгорит после открытия')
    // Содержимого в разметке нет: ни <img>, ни адреса файла.
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('/media/abc.png')
    wrapper.unmount()
  })

  it('открытое вложение показывает «Просмотрено» и не открывается повторно', () => {
    const wrapper = mountAttachment(messageWith({ view_once: true, view_once_opened: true }))

    const plate = wrapper.find('.attachment-view-once')
    expect(plate.classes()).toContain('opened')
    expect(plate.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Просмотрено')
    wrapper.unmount()
  })

  it('обычное вложение остаётся обычной картинкой', () => {
    const wrapper = mountAttachment(messageWith({}))

    expect(wrapper.find('.attachment-view-once').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(true)
    wrapper.unmount()
  })

  it('нажатие просит открыть одноразовое вложение', async () => {
    const wrapper = mountAttachment(messageWith({ view_once: true }))

    await wrapper.find('.attachment-view-once').trigger('click')

    expect(wrapper.emitted('open-view-once')).toBeTruthy()
    expect(wrapper.emitted('open-image')).toBeUndefined()
    wrapper.unmount()
  })

  it('подпись различает видео', () => {
    const wrapper = mountAttachment(
      messageWith({
        view_once: true,
        file: { name: 'sekret.mp4', url: '/media/v.mp4', mime: 'video/mp4', size: 2048 }
      })
    )

    expect(wrapper.text()).toContain('Одноразовое видео')
    wrapper.unmount()
  })
})

describe('отправка одноразовых медиа', () => {
  it('сервис передаёт флаг на сервер', () => {
    expect(service).toContain('viewOnce = false')
    expect(service).toContain("params.view_once = 'true'")
  })

  it('в композере есть выбор «посмотреть один раз»', () => {
    expect(composer).toContain('Посмотреть один раз')
    expect(composer).toContain('pickAttachment(true)')
    // Одноразовым может быть только медиа: «сгорающий» архив смысла не имеет.
    expect(composer).toContain("file.type.startsWith('image/') || file.type.startsWith('video/')")
    expect(composer).toContain("emit('files-selected', files, viewOnce)")
  })

  it('флаг доходит до отправки вложения в Messenger', () => {
    // Подпись функции выросла (появились параметры альбома), поэтому проверяем
    // сам факт передачи флага «посмотреть один раз», а не строку целиком.
    expect(messenger).toContain('const sendFileMessage = async (')
    expect(messenger).toContain('viewOnce = false')
    expect(messenger).toContain('viewOnce,')
    expect(messenger).toContain('sendAttachmentMessage(')
    // Одноразовый файл альбомом не отправляется: сервер отвечает 400.
    expect(messenger).toContain('planFileSend(files, !viewOnce)')
  })
})

describe('просмотр одноразового вложения', () => {
  it('своё окно: без листания и без кнопки «Скачать»', () => {
    expect(viewer).toContain('vo-media')
    // Ни кнопки скачивания (`download`), ни листания соседних кадров: у
    // «сгорающего» медиа и то и другое недопустимо.
    expect(viewer).not.toContain('download')
    expect(viewer).not.toContain('lb-nav')
    expect(viewer).not.toContain("emit('prev')")
    // Честное предупреждение про скриншот: запретить его нельзя, но сказать надо.
    expect(viewer).toContain('Скриншот')
  })

  it('файл скачивается один раз в память вкладки, а не берётся из адреса', () => {
    const open = messenger.slice(messenger.indexOf('const fetchViewOnceUrl'))
    expect(open.slice(0, 900)).toContain('fetch(mediaUrl(file.url))')
    expect(open.slice(0, 900)).toContain('URL.createObjectURL')
    // Свою копию отпускаем при закрытии — одноразовое не должно остаться в памяти.
    const close = messenger.slice(messenger.indexOf('const closeViewOnce'))
    expect(close.slice(0, 400)).toContain('revokeObjectURL')
  })

  it('повторное открытие заблокировано и локально', () => {
    const open = messenger.slice(messenger.indexOf('const openViewOnce'))
    expect(open.slice(0, 400)).toContain('view_once_opened')
    expect(open.slice(0, 400)).toContain('viewOnceOpened.has')
    expect(open.slice(0, 900)).toContain('message.view_once_opened = true')
  })
})

describe('пересылка одноразового запрещена в интерфейсе', () => {
  it('в панели действий и в листе нет кнопки пересылки', () => {
    expect(actionsBar).toContain('v-if="!message.view_once"')
    expect(actionSheet).toContain('v-if="!message.view_once"')
    // И сохранение/стикеры тоже: они копируют содержимое.
    expect(actionSheet).toContain('canSave && !message.view_once')
  })
})
