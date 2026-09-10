import { describe, expect, it } from 'vitest'
import { chatIdFromUrl, chatUrlWith, readStoredChatId, storeChatId } from '@/utils/chatUrl'

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

describe('память об открытом чате (запуск PWA с домашнего экрана)', () => {
  /** Простая заглушка localStorage. */
  const makeStorage = (): Storage => {
    const map = new Map<string, string>()
    return {
      get length() {
        return map.size
      },
      clear: () => map.clear(),
      getItem: (key: string) => map.get(key) ?? null,
      key: (index: number) => Array.from(map.keys())[index] ?? null,
      removeItem: (key: string) => void map.delete(key),
      setItem: (key: string, value: string) => void map.set(key, value)
    } as Storage
  }

  it('запоминает и читает id чата', () => {
    const storage = makeStorage()
    storeChatId(42, storage)
    expect(readStoredChatId(storage)).toBe(42)
  })

  it('забывает чат, когда он закрыт', () => {
    const storage = makeStorage()
    storeChatId(42, storage)
    storeChatId(null, storage)
    expect(readStoredChatId(storage)).toBeNull()
  })

  it('не падает на мусоре в хранилище', () => {
    const storage = makeStorage()
    storage.setItem('pismo_open_chat', 'не число')
    expect(readStoredChatId(storage)).toBeNull()
  })

  it('переживает недоступное хранилище', () => {
    expect(readStoredChatId(null)).toBeNull()
    expect(() => storeChatId(1, null)).not.toThrow()
  })
})
