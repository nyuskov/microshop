import { describe, expect, it } from 'vitest'

import { avatarStyle, displayName, fullName, initials } from '@/utils/user'

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
