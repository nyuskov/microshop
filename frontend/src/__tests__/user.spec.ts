import { afterEach, describe, expect, it } from 'vitest'

import {
  avatarFullUrlOf,
  avatarStyle,
  avatarUrlOf,
  contactNameOf,
  displayName,
  fullName,
  groupAvatarUrl,
  initials,
  setContactNames
} from '@/utils/user'
import type { Chat } from '@/types'

describe('avatarUrlOf', () => {
  it('берёт миниатюру: в интерфейсе аватар — кружок 40–56px', () => {
    expect(
      avatarUrlOf({
        avatar_url: '/media/avatars/user_1_full.png',
        avatar_thumb_url: '/media/avatars/user_1_t128.jpg'
      })
    ).toContain('/media/avatars/user_1_t128.jpg')
  })

  it('без миниатюры (старый аватар) показывает оригинал', () => {
    expect(avatarUrlOf({ avatar_url: '/media/avatars/user_1_full.png' })).toContain(
      'user_1_full.png'
    )
    expect(avatarUrlOf({ avatar_url: null, avatar_thumb_url: null })).toBeUndefined()
    expect(avatarUrlOf(null)).toBeUndefined()
  })

  it('avatarFullUrlOf всегда даёт оригинал — для крупного показа', () => {
    const user = {
      avatar_url: '/media/avatars/user_1_full.png',
      avatar_thumb_url: '/media/avatars/user_1_t128.jpg'
    }
    expect(avatarFullUrlOf(user)).toContain('user_1_full.png')
    expect(avatarFullUrlOf({ avatar_url: null })).toBeUndefined()
  })
})

describe('groupAvatarUrl', () => {
  const group = (extra: Partial<Chat>): Chat =>
    ({
      id: 1,
      name: 'Группа',
      is_group: true,
      users: [
        {
          id: 1,
          username: 'a',
          first_name: null,
          last_name: null,
          phone_number: null,
          avatar_url: null
        },
        {
          id: 2,
          username: 'b',
          first_name: null,
          last_name: null,
          phone_number: null,
          avatar_url: null
        }
      ],
      ...extra
    }) as Chat

  it('предпочитает миниатюру группы', () => {
    const chat = group({
      avatar_url: '/media/avatars/chat_1_full.png',
      avatar_thumb_url: '/media/avatars/chat_1_t128.jpg'
    })
    expect(groupAvatarUrl(chat)).toContain('chat_1_t128.jpg')
  })

  it('без миниатюры — оригинал; у личного чата аватара группы нет', () => {
    expect(groupAvatarUrl(group({ avatar_url: '/media/avatars/chat_1_full.png' }))).toContain(
      'chat_1_full.png'
    )
    const privateChat = group({ is_group: false, avatar_url: '/media/avatars/chat_1_full.png' })
    expect(groupAvatarUrl(privateChat)).toBeUndefined()
  })
})

describe('displayName', () => {
  it('собирает имя из first_name + last_name или username', () => {
    expect(displayName({ username: 'u', first_name: 'Иван', last_name: 'Петров' })).toBe(
      'Иван Петров'
    )
    expect(displayName({ username: 'u', first_name: 'Иван', last_name: null })).toBe('Иван')
    expect(displayName({ username: 'u', first_name: null, last_name: 'Петров' })).toBe('Петров')
    expect(displayName({ username: 'vasya', first_name: null, last_name: null })).toBe('vasya')
  })

  it('fullName — низкоуровневый вариант того же правила', () => {
    expect(fullName('А', 'Б', 'u')).toBe('А Б')
    expect(fullName(null, null, 'u')).toBe('u')
  })
})

describe('initials', () => {
  it('берёт первые буквы первого и второго слова', () => {
    expect(initials('Иван Петров')).toBe('ИП')
  })

  it('для одного слова берёт первые две буквы, пустота → ?', () => {
    expect(initials('Иван')).toBe('ИВ')
    expect(initials('  ')).toBe('?')
  })
})

describe('avatarStyle', () => {
  it('возвращает детерминированный градиент для одного и того же имени', () => {
    const a = avatarStyle('Иван Петров')
    const b = avatarStyle('Иван Петров')
    expect(a).toEqual(b)
    expect(a.background).toMatch(/^linear-gradient/)
  })

  it('разные имена обычно дают разный градиент', () => {
    const styles = new Set(
      ['Анна Смирнова', 'Пётр Иванов', 'Мария Кузнецова'].map((n) => avatarStyle(n).background)
    )
    expect(styles.size).toBeGreaterThan(1)
  })
})

describe('личные имена контактов', () => {
  afterEach(() => {
    // Реестр имён — модульное состояние: чистим, чтобы не протекало в другие тесты.
    setContactNames({})
  })

  it('displayName показывает имя контакта вместо имени из профиля', () => {
    setContactNames({ 7: 'Мама' })
    expect(
      displayName({ id: 7, username: 'phone_ab12cd', first_name: null, last_name: null })
    ).toBe('Мама')
    expect(contactNameOf(7)).toBe('Мама')
  })

  it('без личного имени работает обычное правило (профиль → логин)', () => {
    setContactNames({ 7: 'Мама' })
    expect(displayName({ id: 8, username: 'u', first_name: 'Иван', last_name: null })).toBe('Иван')
    expect(displayName({ username: 'u', first_name: null, last_name: null })).toBe('u')
    expect(contactNameOf(null)).toBeUndefined()
  })
})
