import { beforeEach, describe, expect, it } from 'vitest'
import {
  chatIdFromUrl,
  chatUrlWith,
  isPageReload,
  readStoredSection,
  storeSection
} from '@/utils/chatUrl'

describe('chatIdFromUrl', () => {
  it('читает id чата из параметров', () => {
    expect(chatIdFromUrl('?chat=15')).toBe(15)
  })

  it('работает вместе с другими параметрами', () => {
    expect(chatIdFromUrl('?call=abc&peer=3&chat=42')).toBe(42)
  })

  it('возвращает null, если параметра нет', () => {
    expect(chatIdFromUrl('')).toBeNull()
    expect(chatIdFromUrl('?call=abc&peer=3')).toBeNull()
  })

  it('возвращает null для мусора вместо id', () => {
    expect(chatIdFromUrl('?chat=abc')).toBeNull()
    expect(chatIdFromUrl('?chat=-3')).toBeNull()
    expect(chatIdFromUrl('?chat=0')).toBeNull()
    expect(chatIdFromUrl('?chat=1.5')).toBeNull()
  })
})

describe('chatUrlWith', () => {
  it('добавляет параметр чата', () => {
    expect(chatUrlWith('/', 15)).toBe('/?chat=15')
  })

  it('заменяет чат при переходе в другой', () => {
    expect(chatUrlWith('/?chat=15', 42)).toBe('/?chat=42')
  })

  it('убирает параметр при возврате в список', () => {
    expect(chatUrlWith('/?chat=15', null)).toBe('/')
  })

  it('сохраняет параметры запуска звонка (по ним возвращаемся в звонок)', () => {
    expect(chatUrlWith('/?call=abc&peer=3&action=focus', 15)).toBe(
      '/?call=abc&peer=3&action=focus&chat=15'
    )
    expect(chatUrlWith('/?call=abc&peer=3&chat=15', null)).toBe('/?call=abc&peer=3')
  })

  it('не держит в адресе одноразовую пометку «прочитано»', () => {
    expect(chatUrlWith('/?chat=15&markread=1', 15)).toBe('/?chat=15')
  })

  it('сохраняет переход по «#»-ссылке', () => {
    expect(chatUrlWith('/#top', 15)).toBe('/?chat=15#top')
  })

  it('результат читается обратно', () => {
    const url = chatUrlWith('/?chat=15', 42)
    expect(chatIdFromUrl(url.slice(url.indexOf('?')))).toBe(42)
  })
})

describe('перезагрузка против запуска приложения заново', () => {
  beforeEach(() => localStorage.clear())

  /** Подменяет тип загрузки страницы (jsdom не заполняет Navigation Timing). */
  const stubNavigation = (type: 'reload' | 'navigate' | 'back_forward') => {
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ type }]
    })
  }

  it('перезагрузку считает перезагрузкой', () => {
    stubNavigation('reload')
    expect(isPageReload()).toBe(true)
  })

  it('обычное открытие перезагрузкой не считает', () => {
    stubNavigation('navigate')
    expect(isPageReload()).toBe(false)
  })

  it('при перезагрузке возвращает в тот же раздел', () => {
    stubNavigation('reload')
    storeSection('stories')
    expect(readStoredSection()).toBe('stories')
    storeSection('contacts')
    expect(readStoredSection()).toBe('contacts')
  })

  it('при запуске приложения заново всегда открывает главную — чаты', () => {
    stubNavigation('navigate')
    storeSection('stories')
    expect(readStoredSection()).toBe('chats')
    // Память тоже приведена в порядок: следующая перезагрузка вернёт в «Чаты»,
    // а не в раздел, из которого человек уходил до закрытия приложения.
    expect(localStorage.getItem('pismo_view')).toBe('chats')
  })

  it('без Navigation Timing считает, что приложение запустили заново', () => {
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => []
    })
    storeSection('contacts')
    expect(readStoredSection()).toBe('chats')
  })

  it('мусор в хранилище не ломает запуск', () => {
    stubNavigation('reload')
    localStorage.setItem('pismo_view', 'что-то не то')
    expect(readStoredSection()).toBe('chats')
  })
})
