import { describe, expect, it } from 'vitest'

import {
  chatAvatarOf,
  chatPeerOnline,
  chatTitleOf,
  draftOf,
  isChatTyping,
  lastMessageIsOut,
  previewCallOf,
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

/**
 * Звонок в превью списка чатов (жалоба пользователя 15.09.2026: «если был
 * звонок, в превью нет никакого упоминания»).
 *
 * У записи о звонке `text` пустой (сервер пишет `text=""`, см.
 * `api_v1/calls/views.py::_persist_call_record`), поэтому без явной ветки в
 * превью не было ни типа звонка, ни того, чем он закончился.
 */
describe('previewText: запись о звонке', () => {
  const call = (patch: Partial<Message> = {}) =>
    message({ kind: 'call', call_kind: 'audio', call_state: 'missed', text: '', ...patch })

  it('пропущенный звонок — по строке видно, что не ответили', () => {
    expect(previewText(chat({ last_message: call() }), 1)).toBe('Пропущенный звонок')
  })

  it('видеозвонок отличается от аудио', () => {
    expect(previewText(chat({ last_message: call({ call_kind: 'video' }) }), 1)).toBe(
      'Пропущенный видеозвонок'
    )
  })

  it('состоявшийся звонок — с длительностью и префиксом «Вы:» у исходящего', () => {
    const outgoing = call({
      user_id: 1,
      call_kind: 'video',
      call_state: 'completed',
      call_duration: 65
    })
    expect(previewText(chat({ last_message: outgoing }), 1)).toBe('Вы: Видеозвонок · 01:05')
  })

  it('отклонённый звонок назван явно', () => {
    expect(previewText(chat({ last_message: call({ call_state: 'declined' }) }), 1)).toBe(
      'Аудиозвонок отклонён'
    )
  })

  it('короткий разговор не ломает строку', () => {
    const short = call({ user_id: 1, call_state: 'completed', call_duration: 9 })
    expect(previewText(chat({ last_message: short }), 1)).toBe('Вы: Аудиозвонок · 00:09')
  })
})

describe('previewCallOf: иконка и тон отметки в строке', () => {
  const call = (patch: Partial<Message> = {}) =>
    message({ kind: 'call', call_kind: 'audio', call_state: 'completed', text: '', ...patch })

  it('не звонок — отметки нет', () => {
    expect(previewCallOf(null)).toBeNull()
    expect(previewCallOf(message({ text: 'привет' }))).toBeNull()
  })

  it('пропущенный и отклонённый — «тревожный» тон', () => {
    expect(previewCallOf(call({ call_state: 'missed' }))).toEqual({
      icon: 'call_missed',
      missed: true
    })
    expect(previewCallOf(call({ call_state: 'declined' }))).toEqual({
      icon: 'call_end',
      missed: true
    })
  })

  it('состоявшийся звонок — иконка по типу (аудио/видео)', () => {
    expect(previewCallOf(call())).toEqual({ icon: 'call', missed: false })
    expect(previewCallOf(call({ call_kind: 'video' }))).toEqual({
      icon: 'videocam',
      missed: false
    })
  })
})
