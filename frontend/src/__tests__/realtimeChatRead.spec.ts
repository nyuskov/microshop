/**
 * Прочтение чата: своё (с другого устройства) гасит значок, чужое — нет.
 *
 * Симптом из жизни: чат прочитан на компьютере, а на телефоне значок
 * непрочитанного висел, пока не перезагрузишь страницу. Сервер сообщал о
 * прочтении только собеседнику (для галочек ✓✓), а своим же сессиям — нет,
 * поэтому здесь проверяем разбор события `chat.read-self`.
 */
import { describe, expect, it, vi } from 'vitest'

/** Перехватываем обработчик, который composable регистрирует у стора. */
const captured: { handler?: (event: unknown) => void } = {}

vi.mock('@/stores/realtime', () => ({
  useRealtimeStore: () => ({
    setHandler: (handler: (event: unknown) => void) => {
      captured.handler = handler
    },
    connect: async () => true,
    disconnect: () => undefined
  })
}))

import { useRealtimeSync } from '@/composables/useRealtimeSync'

function makeOptions() {
  return {
    isAuthenticated: () => true,
    isMe: (userId: number) => userId === 1,
    getSelectedChatId: () => null,
    onPresence: vi.fn(),
    onTyping: vi.fn(),
    onTypingStop: vi.fn(),
    onChatsSync: vi.fn(),
    onThreadSync: vi.fn(),
    onChatReadElsewhere: vi.fn()
  }
}

describe('реальное время: прочтение чата', () => {
  it('своё прочтение на другом устройстве гасит значок непрочитанного', () => {
    const options = makeOptions()
    const sync = useRealtimeSync(options)
    sync.start()
    try {
      captured.handler?.({ type: 'chat.read-self', chat_id: 7 })

      expect(options.onChatReadElsewhere).toHaveBeenCalledWith(7)
    } finally {
      sync.stop()
    }
  })

  it('прочтение собеседником не гасит мои значки (это только галочки ✓✓)', () => {
    const options = makeOptions()
    const sync = useRealtimeSync(options)
    sync.start()
    try {
      captured.handler?.({ type: 'chat.read', chat_id: 7, reader_id: 2 })

      expect(options.onChatReadElsewhere).not.toHaveBeenCalled()
    } finally {
      sync.stop()
    }
  })

  it('своё прочтение обновляет открытый чат, чтобы не показывать значок себе', () => {
    const options = makeOptions()
    const sync = useRealtimeSync(options)
    sync.start()
    try {
      captured.handler?.({ type: 'chat.read', chat_id: 7, reader_id: 1 })

      // Своё событие `chat.read` не значит «собеседник прочитал» — галочки не
      // трогаем, но и значок непрочитанного показывать не должны.
      expect(options.onChatReadElsewhere).not.toHaveBeenCalled()
      expect(options.onThreadSync).not.toHaveBeenCalled()
    } finally {
      sync.stop()
    }
  })
})
