import { describe, expect, it } from 'vitest'
import type { Chat, Message } from '@/types'
import {
  chatOfMessage,
  messageChatTitle,
  messageSenderPrefix,
  messageSnippetText
} from '@/utils/messageSearch'

/**
 * Подписи результатов поиска по сообщениям: где нашлось, что именно и от кого.
 * Логика вынесена из разметки сайдбара, поэтому проверяется без DOM.
 */
const chat = (id: number, name: string): Chat =>
  ({ id, name, is_group: false, users: [] }) as unknown as Chat

const message = (patch: Partial<Message>): Message =>
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

describe('chatOfMessage', () => {
  it('находит чат по id сообщения', () => {
    expect(chatOfMessage([chat(5, 'A'), chat(7, 'B')], message({}))?.id).toBe(7)
  })

  it('возвращает undefined, если чата нет в списке', () => {
    expect(chatOfMessage([chat(5, 'A')], message({}))).toBeUndefined()
  })
})

describe('messageChatTitle', () => {
  it('берёт название чата', () => {
    expect(messageChatTitle([chat(7, 'Работа')], message({}), 1)).toBe('Работа')
  })

  it('подписывает номером чата, если чата нет в списке', () => {
    expect(messageChatTitle([], message({ chat_id: 42 }), 1)).toBe('#42')
  })
})

describe('messageSenderPrefix', () => {
  it('помечает свои сообщения', () => {
    expect(messageSenderPrefix(message({ user_id: 1 }), 1)).toBe('Вы: ')
  })

  it('чужие сообщения не помечает', () => {
    expect(messageSenderPrefix(message({ user_id: 2 }), 1)).toBe('')
  })

  it('без известного пользователя ничего не помечает', () => {
    expect(messageSenderPrefix(message({ user_id: 1 }), null)).toBe('')
  })
})

describe('messageSnippetText', () => {
  it('показывает текст сообщения', () => {
    expect(messageSnippetText(message({ text: 'как дела?' }))).toBe('как дела?')
  })

  it('скрытое модератором сообщение не раскрывает', () => {
    expect(messageSnippetText(message({ text: 'секрет', hidden: true }))).toBe(
      'Скрыто до проверки модератором'
    )
  })

  it('зашифрованное вложение подписывает типом и замком', () => {
    const encrypted = message({
      text: null,
      encrypted: true,
      file: { name: 'enc.bin', mime: 'image/png', size: 10 } as Message['file']
    })

    expect(messageSnippetText(encrypted)).toBe('🔒 Изображение')
  })

  it('обычное вложение подписывает типом', () => {
    const withFile = message({
      text: null,
      file: { name: 'док.pdf', mime: 'application/pdf', size: 10 } as Message['file']
    })

    expect(messageSnippetText(withFile)).toBe('Файл: док.pdf')
  })

  it('пустое сообщение без вложения ничего не показывает', () => {
    expect(messageSnippetText(message({ text: null }))).toBe('')
  })
})
