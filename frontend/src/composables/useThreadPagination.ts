/**
 * Страницы истории сообщений открытого чата: свежая при открытии, догрузка вверх.
 *
 * Три операции и их общие флаги:
 * - `loadThreadLatest` — открыли чат, взяли последнюю страницу (сброс «старых»);
 * - `mergeThreadLatest` — пришла свежая страница (WS-событие, возврат связи):
 *   склеиваем с уже загруженной историей выше, ничего не теряя, и прокручиваем
 *   вниз только если человек и так был внизу;
 * - `loadOlderMessages` — прокрутка вверх: подгружаем страницу ДО самой старой и
 *   возвращаем позицию прокрутки, иначе лента «прыгала» бы в начало.
 *
 * Вынесено из `Messenger.vue`: это одна тема, а мессенджер только связывает её с
 * лентой. Зависимости — геттерами (объявлены ниже вызова, см. граблю TDZ в шапке
 * файла); расшифровка страницы приходит колбэком: E2EE — не тема пагинации.
 */

import { nextTick, ref, type Ref } from 'vue'

import { fetchMessages } from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'
import type { Message } from '@/types'

/** Сколько сообщений берём за одну страницу. */
export const MESSAGES_PAGE_SIZE = 80

/** Что нужно от ленты: позиция прокрутки, «мы внизу» и прокрутка вниз. */
export interface ThreadScrollHandle {
  capture(): { top: number; height: number } | null
  restoreScroll(top: number, height: number): void
  isNearBottom(): boolean
  scrollToBottom(): void
}

export interface ThreadPaginationDeps {
  /** Сообщения открытого чата: composable их и наполняет. */
  messages: Ref<Message[]>
  selectedChatId: () => number | null
  thread: () => ThreadScrollHandle | null
  /** Расшифровка страницы истории (E2EE) — вне этой темы. */
  decryptPage: (chatId: number, list: Message[]) => Promise<Message[]>
}

export function useThreadPagination(deps: ThreadPaginationDeps) {
  /** Идёт загрузка страницы: лента показывает «Загружаю…». */
  const messagesLoading = ref(false)
  /** История кончилась: выше запрашивать нечего. */
  const noMoreOlder = ref(false)
  const loadingOlder = ref(false)

  const scrollToBottom = (): void => {
    deps.thread()?.scrollToBottom()
  }

  /** Заменяет сообщение в ленте (правка, закрепление, реакция). */
  const replaceMessageInThread = (updated: Message): void => {
    deps.messages.value = deps.messages.value.map((m) => (m.id === updated.id ? updated : m))
  }

  const removeMessageFromThread = (messageId: number): void => {
    deps.messages.value = deps.messages.value.filter((m) => m.id !== messageId)
  }

  /** Загружает самую свежую страницу (при открытии чата). */
  const loadThreadLatest = async (chatId: number): Promise<void> => {
    messagesLoading.value = true
    noMoreOlder.value = false
    loadingOlder.value = false
    try {
      deps.messages.value = await deps.decryptPage(
        chatId,
        await fetchMessages(chatId, { limit: MESSAGES_PAGE_SIZE })
      )
    } catch (error) {
      console.error('Не удалось загрузить сообщения:', getErrorMessage(error))
    } finally {
      messagesLoading.value = false
    }
  }

  /**
   * Объединяет свежую «последнюю страницу» с уже загруженными старыми
   * сообщениями (не роняет загруженную выше историю) и при новых сообщениях
   * прокручивает вниз, только если пользователь и так внизу.
   */
  const mergeThreadLatest = async (chatId: number): Promise<boolean> => {
    const previousIds = new Set(deps.messages.value.map((m) => m.id))
    const freshRaw = await fetchMessages(chatId, { limit: MESSAGES_PAGE_SIZE })
    const fresh = await deps.decryptPage(chatId, freshRaw)
    const freshIds = new Set(fresh.map((m) => m.id))
    const keptOlder = deps.messages.value.filter((m) => !freshIds.has(m.id))
    deps.messages.value = [...keptOlder, ...fresh].sort((a, b) => a.id - b.id)
    const hasNew = fresh.some((m) => !previousIds.has(m.id))
    const thread = deps.thread()
    if (hasNew && (!thread || thread.isNearBottom())) {
      await nextTick()
      scrollToBottom()
    }
    return hasNew
  }

  /** Подгружает более старые сообщения при прокрутке вверх (вызывается лентой). */
  const loadOlderMessages = async (): Promise<void> => {
    const chatId = deps.selectedChatId()
    const loaded = deps.messages.value
    if (chatId === null || loadingOlder.value || noMoreOlder.value || loaded.length === 0) {
      return
    }
    const saved = deps.thread()?.capture()
    const prevScrollHeight = saved?.height ?? 0
    const prevScrollTop = saved?.top ?? 0
    const oldestId = loaded.reduce<number | null>(
      (min, m) => (min === null || m.id < min ? m.id : min),
      null
    )
    loadingOlder.value = true
    try {
      const olderRaw = await fetchMessages(chatId, {
        limit: MESSAGES_PAGE_SIZE,
        beforeId: oldestId ?? undefined
      })
      const older = await deps.decryptPage(chatId, olderRaw)
      const existingIds = new Set(deps.messages.value.map((m) => m.id))
      const toAdd = older.filter((m) => !existingIds.has(m.id))
      if (older.length === 0 || toAdd.length === 0) {
        noMoreOlder.value = true
        return
      }
      deps.messages.value = [...toAdd, ...deps.messages.value].sort((a, b) => a.id - b.id)
      await nextTick()
      deps.thread()?.restoreScroll(prevScrollTop, prevScrollHeight)
    } catch (error) {
      console.error('Не удалось загрузить более старые сообщения:', getErrorMessage(error))
    } finally {
      loadingOlder.value = false
    }
  }

  return {
    messagesLoading,
    noMoreOlder,
    loadingOlder,
    scrollToBottom,
    replaceMessageInThread,
    removeMessageFromThread,
    loadThreadLatest,
    mergeThreadLatest,
    loadOlderMessages
  }
}
