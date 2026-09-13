import { effectScope, nextTick, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNativeShare } from '@/composables/useNativeShare'
import type { NativeShareDescriptor } from '@/services/nativeShare'
import type { Chat } from '@/types'

/**
 * «Поделиться»: приём содержимого, ожидание входа, превью, лимит размера файла,
 * отправка текста или файла и отмена. Логика вынесена из `Messenger.vue`.
 */

vi.mock('quasar', () => ({
  Notify: { create: vi.fn() }
}))

vi.mock('@/services/nativeShare', async () => {
  const actual =
    await vi.importActual<typeof import('@/services/nativeShare')>('@/services/nativeShare')
  return {
    ...actual,
    clearNativeShare: vi.fn(),
    initNativeShare: vi.fn(() => () => {}),
    readNativeShareFile: vi.fn()
  }
})

vi.mock('@/services/errors', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback
}))

vi.mock('@/utils/shareTarget', () => ({
  // В тестах адрес «чистый»: сценарий PWA проверяется отдельным тестом ниже.
  shareTargetFromSearch: vi.fn(() => null),
  withoutShareTargetParams: (url: string) => url
}))

import { Notify } from 'quasar'
import { clearNativeShare, initNativeShare, readNativeShareFile } from '@/services/nativeShare'
import { shareTargetFromSearch } from '@/utils/shareTarget'

const notifyMock = vi.mocked(Notify.create)

// jsdom не умеет blob-ссылки: подменяем их на заглушки для превью картинки.
const createObjectUrl = vi.fn(() => 'blob:preview')
const revokeObjectUrl = vi.fn()
Object.defineProperty(URL, 'createObjectURL', { value: createObjectUrl, writable: true })
Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectUrl, writable: true })
const clearMock = vi.mocked(clearNativeShare)
const readMock = vi.mocked(readNativeShareFile)
const payloadMock = vi.mocked(shareTargetFromSearch)

const descriptor = (patch: Partial<NativeShareDescriptor> = {}): NativeShareDescriptor => ({
  text: 'привет',
  subject: '',
  mime: '',
  name: '',
  size: 0,
  hasFile: false,
  ...patch
})

const chat = (id: number): Chat => ({ id, name: `Чат ${id}`, users: [] }) as unknown as Chat

describe('useNativeShare', () => {
  let scope: EffectScope
  let authenticated: boolean
  let selectedChatId: number | null
  let sentText: [number, string][]
  let sentFiles: [number, string, string][]
  let chatsRefreshed: number
  let threadsRefreshed: number
  let share: ReturnType<typeof useNativeShare>

  beforeEach(() => {
    vi.clearAllMocks()
    authenticated = true
    selectedChatId = null
    sentText = []
    sentFiles = []
    chatsRefreshed = 0
    threadsRefreshed = 0
    payloadMock.mockReturnValue(null)

    scope = effectScope()
    scope.run(() => {
      share = useNativeShare({
        isAuthenticated: () => authenticated,
        chats: () => [chat(1), chat(2)],
        currentUserId: () => 1,
        selectedChatId: () => selectedChatId,
        sendText: async (chatId, text) => {
          sentText.push([chatId, text])
        },
        sendFile: async (chatId, file, caption) => {
          sentFiles.push([chatId, file.name, caption])
        },
        refreshChats: async () => {
          chatsRefreshed += 1
        },
        refreshThread: async () => {
          threadsRefreshed += 1
        }
      })
    })
  })

  afterEach(() => {
    scope.stop()
  })

  /** Отправляет содержимое в обёртку «поделиться» и возвращает состояние. */
  const accept = async (incoming: NativeShareDescriptor) => {
    vi.mocked(initNativeShare).mock.calls.at(-1)?.[0]?.(incoming)
    await nextTick()
    await Promise.resolve()
  }

  it('текст от «поделиться» показывается в диалоге', async () => {
    await accept(descriptor({ text: 'ссылка' }))

    expect(share.descriptor.value?.text).toBe('ссылка')
    expect(share.file.value).toBeNull()
  })

  it('до входа содержимое придерживается и появляется после', async () => {
    authenticated = false
    await accept(descriptor({ text: 'ссылка' }))
    expect(share.descriptor.value).toBeNull()

    authenticated = true
    await share.releasePending()

    expect(share.descriptor.value?.text).toBe('ссылка')
  })

  it('картинка читается и получает превью', async () => {
    const image = new File(['x'], 'photo.png', { type: 'image/png' })
    readMock.mockResolvedValue(image)
    await accept(descriptor({ hasFile: true, size: 100, mime: 'image/png', name: 'photo.png' }))

    expect(share.file.value).toBe(image)
    expect(share.previewUrl.value).toBe('blob:preview')
  })

  it('слишком большой файл заменяется текстом с предупреждением', async () => {
    await accept(descriptor({ hasFile: true, size: 21 * 1024 * 1024, text: 'подпись' }))

    expect(share.descriptor.value?.hasFile).toBe(false)
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Файл слишком большой' })
    )
    expect(readMock).not.toHaveBeenCalled()
  })

  it('отправка текста уходит в выбранный чат, диалог закрывается', async () => {
    await accept(descriptor({ text: 'привет' }))

    await share.send(2)

    expect(sentText).toEqual([[2, 'привет']])
    expect(chatsRefreshed).toBe(1)
    expect(share.descriptor.value).toBeNull()
    expect(clearMock).toHaveBeenCalled()
  })

  it('отправка файла передаёт подпись, а превью освобождается', async () => {
    const image = new File(['x'], 'photo.png', { type: 'image/png' })
    readMock.mockResolvedValue(image)
    await accept(descriptor({ hasFile: true, size: 100, mime: 'image/png', text: 'подпись' }))

    await share.send(1)

    expect(sentFiles).toEqual([[1, 'photo.png', 'подпись']])
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:preview')
  })

  it('лента перечитывается, если отправили в открытый чат', async () => {
    selectedChatId = 1
    await accept(descriptor({ text: 'привет' }))

    await share.send(1)

    expect(threadsRefreshed).toBe(1)
  })

  it('ошибка отправки показывается уведомлением', async () => {
    const errorNotify = vi.fn()
    notifyMock.mockImplementation((opts) => {
      if (opts.message === 'Не удалось отправить') errorNotify(opts)
    })
    scope.stop()

    let failing: ReturnType<typeof useNativeShare> | undefined
    scope = effectScope()
    scope.run(() => {
      failing = useNativeShare({
        isAuthenticated: () => true,
        chats: () => [chat(1)],
        currentUserId: () => 1,
        selectedChatId: () => null,
        sendText: async () => {
          throw new Error('сеть')
        },
        sendFile: async () => {},
        refreshChats: async () => {},
        refreshThread: async () => {}
      })
    })

    // Содержимое приходит событием нативной оболочки.
    vi.mocked(initNativeShare).mock.calls.at(-1)?.[0]?.(descriptor({ text: 'привет' }))
    await nextTick()
    await failing?.send(1)

    expect(errorNotify).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Не удалось отправить' })
    )
    // Состояние не «залипает»: можно попробовать снова.
    expect(failing?.busy.value).toBe(false)
  })

  it('отмена закрывает диалог и освобождает содержимое', async () => {
    await accept(descriptor({ text: 'привет' }))

    share.cancel()

    expect(share.descriptor.value).toBeNull()
    expect(clearMock).toHaveBeenCalled()
  })

  it('пока идёт отправка, отмена игнорируется', async () => {
    await accept(descriptor({ text: 'привет' }))
    share.busy.value = true

    share.cancel()

    expect(share.descriptor.value).not.toBeNull()
  })

  it('содержимое из адреса PWA принимается на старте', async () => {
    vi.clearAllMocks()
    payloadMock.mockReturnValue({ text: 'ссылка из браузера' })
    scope.stop()

    scope = effectScope()
    let started: ReturnType<typeof useNativeShare> | undefined
    scope.run(() => {
      started = useNativeShare({
        isAuthenticated: () => true,
        chats: () => [chat(1)],
        currentUserId: () => 1,
        selectedChatId: () => null,
        sendText: async () => {},
        sendFile: async () => {},
        refreshChats: async () => {},
        refreshThread: async () => {}
      })
    })

    expect(started?.descriptor.value?.text).toBe('ссылка из браузера')
  })
})
