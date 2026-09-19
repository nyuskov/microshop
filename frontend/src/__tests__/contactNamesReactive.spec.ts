import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { computed } from 'vue'

import { contactNameOf, displayName, setContactNames } from '@/utils/user'

/**
 * Личные имена контактов должны подставляться СРАЗУ и сами.
 *
 * Жалоба владельца (2026-09-20): «иногда сбиваются имена, приходится заходить в
 * чат и обновлять, чтобы стало на место». Причина — реестр имён был обычным
 * объектом: имя считается внутри вычисляемых свойств и кэшируется, а Vue о смене
 * реестра не знал. Чаты грузятся одновременно с контактами, поэтому первые
 * вычисления успевали закэшировать логин (`phone_xxxx`), и «Мама» появлялась
 * только после того, как что-то ещё заставит пересчитать вычисляемое — например,
 * открытие чата.
 *
 * Тест проверяет ровно это: вычисленное ДО загрузки контактов имя обновляется
 * само, без повторного запроса и без «зайти в чат».
 */

const peer = {
  id: 5,
  first_name: null as string | null,
  last_name: null as string | null,
  username: 'phone_5f0bc576'
}

beforeEach(() => {
  setContactNames({})
})

describe('личные имена контактов обновляются сами', () => {
  it('имя, посчитанное до загрузки контактов, меняется на личное', () => {
    const name = computed(() => displayName(peer))
    // Чаты успели отрисоваться раньше контактов — виден логин.
    expect(name.value).toBe('phone_5f0bc576')

    // Контакты догрузились: пересчитывать вручную ничего не нужно.
    setContactNames({ 5: 'Мама' })
    expect(name.value).toBe('Мама')
  })

  it('переименование и удаление контакта тоже видны сразу', () => {
    const name = computed(() => displayName(peer))
    setContactNames({ 5: 'Мама' })
    expect(name.value).toBe('Мама')

    setContactNames({ 5: 'Мамочка' })
    expect(name.value).toBe('Мамочка')

    // Контакт удалили — возвращается имя из профиля/логин.
    setContactNames({})
    expect(name.value).toBe('phone_5f0bc576')
  })

  it('профильное имя сильнее логина, а личное — сильнее профиля', () => {
    const withProfile = { id: 6, first_name: 'Пётр', last_name: 'Иванов', username: 'pete' }
    expect(displayName(withProfile)).toBe('Пётр Иванов')

    setContactNames({ 6: 'Начальник' })
    expect(displayName(withProfile)).toBe('Начальник')
  })

  it('без id (и для null) личного имени нет', () => {
    setContactNames({ 5: 'Мама' })
    expect(contactNameOf(undefined)).toBeUndefined()
    expect(contactNameOf(null)).toBeUndefined()
    expect(contactNameOf(5)).toBe('Мама')
    expect(contactNameOf(99)).toBeUndefined()
  })
})

describe('как это устроено в коде (чтобы не вернули обратно)', () => {
  const read = (path: string): string => readFileSync(path, 'utf8')

  it('реестр имён реактивный', () => {
    const source = read('src/utils/user.ts')
    expect(source).toContain('const contactNames = ref<Record<number, string>>({})')
    expect(source).not.toContain('let contactNames: Record<number, string> = {}')
    expect(source).toContain('contactNames.value[userId]')
  })

  it('стор контактов наполняет реестр сразу и на каждое изменение', () => {
    const store = read('src/stores/contacts.ts')
    expect(store).toContain('setContactNames(names)')
    expect(store).toContain('{ immediate: true, deep: true }')
  })

  it('при входе контакты грузятся вместе с чатами (не только при открытии раздела)', () => {
    const messenger = read('src/views/Messenger.vue')
    expect(messenger).toContain('await Promise.all([loadChats(), loadContacts()])')
  })
})
