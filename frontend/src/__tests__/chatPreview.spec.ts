import { describe, expect, it } from 'vitest'

import {
  chatAvatarOf,
  chatPeerOnline,
  chatTitleOf,
  draftOf,
  isChatTyping,
  lastMessageIsOut,
  previewText
} from '@/utils/chatPreview'
import type { Chat, ChatUser, Message } from '@/types'

/**
 * Подписи строки чата в списке: название, аватар, превью последнего сообщения и
 * признаки «печатает / черновик / прочитано / в сети». Логика вынесена из
 * `ChatSidebar` — проверяем без DOM.
 */

const user = (id: number, patch: Partial<ChatUser> = {}): ChatUser =>
  ({
    id,
    username: `u${id}`,
    first_name: `Имя${id}`,
    last_name: '',
    ...patch
  }) as unknown as ChatUser

const message = (patch: Partial<Message> = {}): Message =>
  ({
    id: 1,
    chat_id: 7,
    user_id: 2,
    text: 'привет',
    hidden: false,
    encrypted: false,
    file: null,
    ...patch
  }) as unknown as Message

const chat = (patch: Partial<Chat> = {}): Chat =>
  ({
    id: 7,
    name: 'Чат',
    is_group: false,
    is_self: false,
    is_channel: false,
    unread_count: 0,
    users: [user(1), user(2)],
    ...patch
  }) as unknown as Chat

describe('chatTitleOf / chatAvatarOf', () => {
  it('личный чат подписывает именем собеседника, а не моим', () => {
    const privateChat = chat()

    expect(chatTitleOf(privateChat, 1)).toBe('Имя2')
    expect(chatTitleOf(privateChat, 2)).toBe('Имя1')
  })

  it('группа берёт имя группы и своё фото', () => {
    const group = chat({
      is_group: true,
      name: 'Команда',
      avatar_url: '/media/groups/g1.png'
    })

    expect(chatTitleOf(group, 1)).toBe('Команда')
    expect(chatAvatarOf(group, 1)).toBe('/media/groups/g1.png')
  })

  it('у личного чата аватар — фото собеседника', () => {
    const privateChat = chat({
      users: [user(1), user(2, { avatar_url: '/media/avatars/u2.png' })]
    })

    expect(chatAvatarOf(privateChat, 1)).toBe('/media/avatars/u2.png')
  })
})

describe('chatPeerOnline', () => {
  it('показывает «в сети» только для собеседника личного чата', () => {
    const privateChat = chat()

    expect(chatPeerOnline(privateChat, 1, [2])).toBe(true)
    expect(chatPeerOnline(privateChat, 1, [1])).toBe(false)
    expect(chatPeerOnline(privateChat, 1, [])).toBe(false)
  })

  it('в группе индикатор не показываем', () => {
    const group = chat({ is_group: true, users: [user(1), user(2), user(3)] })

    expect(chatPeerOnline(group, 1, [2])).toBe(false)
  })
})

describe('isChatTyping', () => {
  it('«печатает» — только про личный чат', () => {
    expect(isChatTyping(chat({ id: 5 }), [5])).toBe(true)
    expect(isChatTyping(chat({ id: 5 }), [6])).toBe(false)

    const group = chat({ id: 5, is_group: true, users: [user(1), user(2), user(3)] })
    expect(isChatTyping(group, [5])).toBe(false)
  })
})

describe('draftOf', () => {
  it('возвращает непустой черновик и игнорирует пустой', () => {
    expect(draftOf(chat({ id: 5 }), { 5: 'привет' })).toBe('привет')
    expect(draftOf(chat({ id: 5 }), { 5: '   ' })).toBeNull()
    expect(draftOf(chat({ id: 5 }), {})).toBeNull()
  })
})

describe('lastMessageIsOut', () => {
  it('отмечает моё последнее сообщение', () => {
    expect(lastMessageIsOut(chat({ last_message: message({ user_id: 1 }) }), 1)).toBe(true)
    expect(lastMessageIsOut(chat({ last_message: message({ user_id: 2 }) }), 1)).toBe(false)
    expect(lastMessageIsOut(chat({ last_message: null }), 1)).toBe(false)
  })
})

describe('previewText', () => {
  it('без сообщений подсказывает, что переписки ещё нет', () => {
    expect(previewText(chat({ last_message: null }), 1)).toBe('Нет сообщений')
  })

  it('своё сообщение помечает «Вы: »', () => {
    const withMessage = chat({ last_message: message({ user_id: 1, text: 'как дела' }) })

    expect(previewText(withMessage, 1)).toBe('Вы: как дела')
  })

  it('в группе подписывает превью автором', () => {
    const group = chat({
      is_group: true,
      users: [user(1), user(2)],
      last_message: message({ user_id: 2, text: 'готово' })
    })

    expect(previewText(group, 1)).toBe('Имя2: готово')
  })

  it('скрытое модератором сообщение не раскрывает', () => {
    const hidden = chat({ last_message: message({ hidden: true, text: 'секрет' }) })

    expect(previewText(hidden, 1)).toBe('Скрыто до проверки модератором')
  })

  it('зашифрованное вложение заменяет текстом типа', () => {
    const locked = chat({
      last_message: message({
        text: null,
        encrypted: true,
        file: { name: 'enc.bin', mime: 'image/png', size: 10 } as Message['file']
      })
    })

    expect(previewText(locked, 1)).toBe('🔒 Изображение')
  })

  it('пересылку помечает стрелкой', () => {
    const forwarded = chat({
      last_message: message({ user_id: 1, text: 'анекдот', forwarded_from: 'Иван' })
    })

    expect(previewText(forwarded, 1)).toBe('Вы: ↪ Переслано: анекдот')
  })

  it('вложение без текста подписывает типом файла', () => {
    const withFile = chat({
      last_message: message({
        user_id: 1,
        text: null,
        file: { name: 'док.pdf', mime: 'application/pdf', size: 10 } as Message['file']
      })
    })

    expect(previewText(withFile, 1)).toBe('Вы: Файл: док.pdf')
  })
})
