/**
 * Очередь сообщений, которые не ушли из-за сети.
 *
 * На телефоне связь пропадает регулярно (метро, лифт, переход Wi-Fi↔LTE): текст
 * остаётся в очереди и уходит сам, как только связь вернулась, — вместо ошибки
 * «Не удалось отправить» и потерянного набора. Очередь живёт в localStorage по
 * пользователю (`utils/outbox.ts`), переживает перезагрузку и не «перетекает»
 * между аккаунтами.
 *
 * Вынесено из `Messenger.vue`: это одна тема (что ждёт связи и как это дослать), а
 * мессенджер только показывает строки очереди под лентой и обновляет открытый чат
 * после доставки. Зависимости — геттерами (объявлены ниже вызова, см. граблю TDZ
 * в шапке файла), последствия доставки — колбэком.
 */

import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'

import { sendNewMessage } from '@/services/chatService'
import { getErrorMessage, isNetworkError } from '@/services/errors'
import {
  addOutboxItem,
  nextOutboxLocalId,
  patchOutboxItem,
  readOutbox,
  removeOutboxItem,
  type OutboxItem
} from '@/utils/outbox'
import type { PendingRow } from '@/components/messenger/MessageThread.vue'
import type { Message } from '@/types'

/** Раз в 20 секунд пробуем дослать застрявшее (если браузер считает, что сеть есть). */
const OUTBOX_RETRY_MS = 20_000

export interface OutboxDeps {
  currentUserId: () => number | null
  selectedChatId: () => number | null
  /** Связь есть? Без неё очередь не трогаем — ждём события «связь вернулась». */
  isOnline: () => boolean
  /** Текст «как он уйдёт»: в зашифрованном чате — шифротекст (в очереди лежит открытым). */
  buildWireText: (chatId: number, text: string) => Promise<{ wireText: string; encrypted: boolean }>
  /** Показать доставленное в открытом чате (лента, закреплённые, прокрутка вниз). */
  onDelivered: (message: Message, chatId: number) => void
  /** Обновить список чатов: превью и порядок изменились. */
  reloadChats: () => Promise<void>
}

export interface OutboxApi {
  /** Сообщения текущего пользователя, ждущие связи (или уже отвергнутые сервером). */
  outboxItems: Ref<OutboxItem[]>
  /** Строки очереди открытого чата (в ленте — под сообщениями). */
  openChatOutboxRows: ComputedRef<PendingRow[]>
  /** Перечитать очередь из хранилища. */
  reloadOutbox: () => void
  /** Поставить сообщение в очередь (связь пропала во время отправки). */
  queueOutgoingText: (chatId: number, text: string, replyToId?: number | null) => void
  /** Отправить всё накопившееся (`onlyId` — ручной повтор одного сообщения). */
  flushOutbox: (onlyId?: string) => Promise<void>
  /** Повтор одного сообщения из очереди (кнопка в ленте). */
  retryOutboxItem: (localId: number) => void
  /** Убрать неотправленное сообщение из очереди. */
  dropOutboxItem: (localId: number) => void
  /** Запустить автоотправку (вызывается один раз на жизненном цикле страницы). */
  startOutboxTimer: () => void
}

export function useOutbox(deps: OutboxDeps): OutboxApi {
  const outboxItems = ref<OutboxItem[]>([])
  /** Id, которые прямо сейчас отправляются (в ленте показываем «Отправка…»). */
  const outboxSending = ref<string[]>([])
  let retryTimer: ReturnType<typeof setInterval> | undefined

  const reloadOutbox = (): void => {
    outboxItems.value = readOutbox(deps.currentUserId())
  }

  // В ленте показываем только сообщения открытого чата: у остальных чатов — свои.
  const openChatOutboxRows = computed<PendingRow[]>(() => {
    const chatId = deps.selectedChatId()
    if (chatId === null) return []
    return outboxItems.value
      .filter((item) => item.chatId === chatId)
      .map((item) => ({
        localId: item.localId,
        label: item.text,
        status: outboxSending.value.includes(item.id)
          ? 'sending'
          : item.state === 'error'
            ? 'failed'
            : 'queued',
        error: item.error ?? null
      }))
  })

  const queueOutgoingText = (chatId: number, text: string, replyToId?: number | null): void => {
    const uid = deps.currentUserId()
    const item: OutboxItem = {
      id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      localId: nextOutboxLocalId(outboxItems.value),
      chatId,
      text,
      replyToId: replyToId ?? null,
      createdAt: new Date().toISOString(),
      state: 'queued'
    }
    addOutboxItem(uid, item)
    reloadOutbox()
  }

  const flushOutbox = async (onlyId?: string): Promise<void> => {
    const uid = deps.currentUserId()
    if (uid === null) return
    const items = outboxItems.value.filter((item) => !onlyId || item.id === onlyId)
    for (const item of items) {
      // Ручной повтор («Повторить» в ленте) отправляем и без сети: пусть попробует.
      if (!onlyId && !deps.isOnline()) return
      outboxSending.value = [...outboxSending.value, item.id]
      try {
        const { wireText, encrypted } = await deps.buildWireText(item.chatId, item.text)
        const message = await sendNewMessage(item.chatId, wireText, item.replyToId, encrypted)
        if (encrypted) {
          // Отправляли шифротекст — в ленте показываем открытый текст, который набрали.
          message.text = item.text
          message.encrypted = false
        }
        removeOutboxItem(uid, item.id)
        reloadOutbox()
        if (deps.selectedChatId() === item.chatId) deps.onDelivered(message, item.chatId)
        await deps.reloadChats()
      } catch (error) {
        if (isNetworkError(error)) {
          // Сеть снова пропала — оставляем в очереди и выходим из цикла: остальные
          // сообщения тоже не уйдут.
          patchOutboxItem(uid, item.id, { state: 'queued', error: undefined })
          reloadOutbox()
          return
        }
        patchOutboxItem(uid, item.id, {
          state: 'error',
          error: getErrorMessage(error, 'Не удалось отправить')
        })
        reloadOutbox()
      } finally {
        outboxSending.value = outboxSending.value.filter((id) => id !== item.id)
      }
    }
  }

  const retryOutboxItem = (localId: number): void => {
    const item = outboxItems.value.find((entry) => entry.localId === localId)
    if (item) void flushOutbox(item.id)
  }

  const dropOutboxItem = (localId: number): void => {
    const item = outboxItems.value.find((entry) => entry.localId === localId)
    if (!item) return
    removeOutboxItem(deps.currentUserId(), item.id)
    reloadOutbox()
  }

  const startOutboxTimer = (): void => {
    if (retryTimer !== undefined) return
    retryTimer = setInterval(() => {
      if (outboxItems.value.length === 0) return
      void flushOutbox()
    }, OUTBOX_RETRY_MS)
  }

  // Ушли со страницы — таймер не нужен (гасим вместе со scope компонента),
  // иначе он бы тянул сетевые попытки из несуществующего интерфейса.
  onScopeDispose(() => {
    if (retryTimer !== undefined) {
      clearInterval(retryTimer)
      retryTimer = undefined
    }
  })

  // Другой пользователь (или вход): очередь своя у каждого, а недославшее пробуем
  // дослать сразу — человек мог набрать это в прошлой сессии.
  watch(
    () => deps.currentUserId(),
    (uid) => {
      reloadOutbox()
      if (uid !== null && outboxItems.value.length > 0) void flushOutbox()
    },
    { immediate: true }
  )

  return {
    outboxItems,
    openChatOutboxRows,
    reloadOutbox,
    queueOutgoingText,
    flushOutbox,
    retryOutboxItem,
    dropOutboxItem,
    startOutboxTimer
  }
}
