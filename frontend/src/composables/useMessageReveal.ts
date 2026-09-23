/**
 * Переходы к сообщению в ленте: подсветка и центрирование.
 *
 * Вынесено из `Messenger.vue` (третий шаг разбора G6): «показать вот это
 * сообщение» нужно из разных мест — закреплённые, глобальный поиск, поиск по
 * чату, клик по цитате-ответу и галерея «Информации о чате». Везде один и тот
 * же набор шагов: найти сообщение (при необходимости догрузив страницу истории),
 * центрировать его в ленте и подсветить на пару секунд.
 *
 * Догрузка страницы особенна тем, что вставка старых сообщений прокручивает
 * ленту вверх — поэтому позиция снимается перед вставкой и возвращается после
 * (`captureScroll`/`restoreScroll`), иначе у человека «прыгал» экран.
 *
 * Зависимости — геттеры и колбэки: часть объявлена в мессенджере ниже вызова,
 * а обращается к ним composable по действию человека (грабля TDZ).
 */

import { nextTick, onScopeDispose, ref, type Ref } from 'vue'

import { t } from '@/i18n'
import { fetchMessages } from '@/services/chatService'
import { MESSAGES_PAGE_SIZE } from '@/composables/useThreadPagination'
import { getErrorMessage } from '@/services/errors'
import type { Message } from '@/types'

/** Сколько держится подсветка перехода (совпадает с анимацией в CSS). */
const HIGHLIGHT_MS = 2400

export interface MessageRevealDeps {
  /** Лента открытого чата: читаем и дописываем догруженную страницу. */
  messages: Ref<Message[]>
  selectedChatId: () => number | null
  /** Снять позицию прокрутки перед вставкой старых сообщений. */
  captureScroll: () => { top: number; height: number } | null | undefined
  /** Вернуть прокрутку на место после вставки. */
  restoreScroll: (top: number, height: number) => void
  /** Расшифровать догруженную страницу (E2EE). */
  decryptPage: (chatId: number, list: Message[]) => Promise<Message[]>
  /** Центрировать сообщение в ленте (метод ленты). */
  revealInThread: (messageId: number) => void
  /** Снять фильтр поиска: в отфильтрованной ленте сообщения может не быть. */
  closeSearch: () => void
  /** Погасить палитру реакций: клик по цитате её закрывает. */
  closeEmojiPicker: () => void
  /** Открыть чат (переход из глобального поиска). */
  openThread: (chatId: number) => Promise<void>
  /** Догрузка старых страниц — пока искомое сообщение не появится в ленте. */
  loadOlderMessages: () => Promise<void>
  /** Старше уже нечего грузить. */
  noMoreOlder: () => boolean
  /** Показать вложение в лайтбоксе (галерея «Информации о чате»). */
  openImage: (message: Message) => void
}

export interface MessageRevealApi {
  /** Сообщение, которое сейчас подсвечено (после перехода). */
  highlightedMessageId: Ref<number | null>
  /** Снять подсветку (смена чата, уход с экрана). */
  clearHighlight: () => void
  /**
   * Гарантирует, что сообщение есть в ленте: если его нет в загруженных
   * страницах — догружает страницу, в которую оно попадает.
   */
  ensureMessageLoaded: (messageId: number) => Promise<Message | undefined>
  /** Центрировать сообщение в ленте и подсветить его. */
  revealMessageInThread: (messageId: number) => Promise<void>
  /** Перейти к закреплённому сообщению (снимая фильтр поиска). */
  scrollToPinnedMessage: (messageId: number) => Promise<void>
  /** Глобальный поиск: открыть чат и перейти к найденному сообщению. */
  openGlobalMessage: (chatId: number, messageId: number) => Promise<void>
  /** Клик по цитате-ответу: перейти к исходному сообщению. */
  quoteClick: (message: Message) => void
  /** Открыть изображение из «Информации о чате» в лайтбоксе. */
  openChatInfoImage: (messageId: number) => Promise<void>
}

export function useMessageReveal(deps: MessageRevealDeps): MessageRevealApi {
  const highlightedMessageId = ref<number | null>(null)
  let highlightTimer: number | undefined

  /** Снять подсветку и её таймер (вызов из чужого места — не сломать состояние). */
  const clearHighlight = (): void => {
    if (highlightTimer !== undefined) {
      window.clearTimeout(highlightTimer)
      highlightTimer = undefined
    }
    highlightedMessageId.value = null
  }

  /**
   * Гарантирует, что сообщение есть в ленте (для перехода к нему/просмотра).
   *
   * Если его нет в загруженных страницах, догружает страницу, в которую оно
   * попадает, вставляет в ленту и возвращает позицию прокрутки на место — иначе
   * лента «прыгнула» бы вверх у пользователя.
   */
  const ensureMessageLoaded = async (messageId: number): Promise<Message | undefined> => {
    const known = deps.messages.value.find((m) => m.id === messageId)
    if (known) return known
    const chatId = deps.selectedChatId()
    if (chatId === null) return undefined
    const saved = deps.captureScroll()
    try {
      const raw = await fetchMessages(chatId, {
        limit: MESSAGES_PAGE_SIZE,
        beforeId: messageId + 1
      })
      const page = await deps.decryptPage(chatId, raw)
      if (!page.some((m) => m.id === messageId)) return undefined
      const existingIds = new Set(deps.messages.value.map((m) => m.id))
      const toAdd = page.filter((m) => !existingIds.has(m.id))
      if (toAdd.length > 0) {
        deps.messages.value = [...toAdd, ...deps.messages.value].sort((a, b) => a.id - b.id)
        await nextTick()
        if (saved) deps.restoreScroll(saved.top, saved.height)
      }
      return deps.messages.value.find((m) => m.id === messageId)
    } catch (error) {
      console.error(t('Не удалось загрузить сообщение с вложением:'), getErrorMessage(error))
      return undefined
    }
  }

  /** Центрировать сообщение в ленте и подсветить его на пару секунд. */
  const revealMessageInThread = async (messageId: number): Promise<void> => {
    if (highlightTimer !== undefined) {
      window.clearTimeout(highlightTimer)
      highlightTimer = undefined
    }
    highlightedMessageId.value = messageId
    await nextTick()
    deps.revealInThread(messageId)
    highlightTimer = window.setTimeout(() => {
      highlightedMessageId.value = null
    }, HIGHLIGHT_MS)
  }

  /** Перейти к закреплённому сообщению. */
  const scrollToPinnedMessage = async (messageId: number): Promise<void> => {
    // Если активен поиск по сообщениям — снимаем фильтр, иначе сообщения может не быть в ленте.
    deps.closeSearch()
    await revealMessageInThread(messageId)
  }

  /** Глобальный поиск: открыть чат и перейти (с подсветкой) к найденному сообщению. */
  const openGlobalMessage = async (chatId: number, messageId: number): Promise<void> => {
    await deps.openThread(chatId)
    // Если сообщения нет в загруженной порции — догружаем более старые.
    if (!deps.messages.value.some((m) => m.id === messageId)) {
      for (let i = 0; i < 40 && !deps.noMoreOlder(); i += 1) {
        await deps.loadOlderMessages()
        if (deps.messages.value.some((m) => m.id === messageId)) break
      }
    }
    await revealMessageInThread(messageId)
  }

  /** Клик по цитате-ответу: закрыть меню и перейти к исходному сообщению. */
  const quoteClick = (message: Message): void => {
    deps.closeEmojiPicker()
    const targetId = message.reply_to_id
    if (targetId == null) return
    // Исходное сообщение может быть не загружено — тогда ничего не делаем.
    if (!deps.messages.value.some((item) => item.id === targetId)) return
    if (highlightTimer !== undefined) {
      window.clearTimeout(highlightTimer)
      highlightTimer = undefined
    }
    highlightedMessageId.value = targetId
    void nextTick(() => {
      deps.revealInThread(targetId)
      highlightTimer = window.setTimeout(() => {
        highlightedMessageId.value = null
      }, HIGHLIGHT_MS)
    })
  }

  /** Открыть изображение из «Информации о чате» в лайтбоксе. */
  const openChatInfoImage = async (messageId: number): Promise<void> => {
    // Галерея показывает вложения всей истории, а в ленте загружены только
    // последние страницы: нужную подгружаем перед открытием лайтбокса.
    const message = await ensureMessageLoaded(messageId)
    if (message) deps.openImage(message)
  }

  // Ушли с экрана (или сменили чат через `clearHighlight`) — таймер не должен
  // срабатывать на чужом состоянии.
  onScopeDispose(clearHighlight)

  return {
    highlightedMessageId,
    clearHighlight,
    ensureMessageLoaded,
    revealMessageInThread,
    scrollToPinnedMessage,
    openGlobalMessage,
    quoteClick,
    openChatInfoImage
  }
}
