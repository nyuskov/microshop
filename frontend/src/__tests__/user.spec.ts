import { afterEach, describe, expect, it } from 'vitest'

import {
  avatarStyle,
  contactNameOf,
  displayName,
  fullName,
  initials,
  setContactNames
} from '@/utils/user'

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
