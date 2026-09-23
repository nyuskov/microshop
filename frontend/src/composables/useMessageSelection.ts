/**
 * Мультивыделение сообщений: удержание на строке включает режим выбора, дальше
 * тап отмечает и снимает сообщения, а панель вместо шапки чата даёт «выбрать все»,
 * переслать, сохранить в «Сохранённые» и удалить.
 *
 * Вынесено из `Messenger.vue`: это одна тема (что выбрано и что с этим делать), а
 * мессенджер только связывает её с лентой и рисует панель. Зависимости — геттерами
 * (в `<script setup>` мессенджера они объявлены ниже вызова, и обращение к ним на
 * этапе setup дало бы TDZ), побочные действия — колбэками.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { t } from '@/i18n'
import { deleteMessage, forwardMessage } from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'
import type { Chat, Message } from '@/types'

export interface MessageSelectionDeps {
  /** Загруженные сообщения открытого чата (по ним считаем «выбрать все»). */
  messages: () => Message[]
  /** Список чатов: в нём ищем свой чат «Сохранённые сообщения». */
  chats: () => Chat[]
  selectedChat: () => Chat | null
  selectedChatId: () => number | null
  currentUserId: () => number | null
  /** Пикер эмодзи у строки: в режиме выбора он лишний. */
  closeEmojiPicker: () => void
  /** Меню строки и реакции: в режиме выбора они мешают отмечать. */
  closePopups: () => void
  clearReply: () => void
  isEditing: () => boolean
  cancelEditing: () => void
  isForwarding: () => boolean
  cancelForward: () => void
  /** Открыть диалог выбора чатов для пересылки. */
  openForward: (sources: Message[]) => void
  /** Убрать сообщение из ленты (после удаления). */
  removeMessageFromThread: (messageId: number) => void
  /**
   * Спросить, как удалять: `me` — только у себя, `all` — у всех, `null` — отмена.
   *
   * Выбор области — диалог, а не `window.confirm`: вариантов два, и один из них
   * («для всех») необратим у собеседника, поэтому его нельзя выбирать молча.
   */
  askDeleteScope: (payload: { count: number; canForAll: boolean }) => Promise<'me' | 'all' | null>
  /** Перечитать список чатов (превью «Сохранённых» обновилось). */
  reloadChats: () => Promise<void>
  /** Перечитать закреплённые — после массового удаления. */
  reloadPinned: (chatId: number) => Promise<void>
}

export interface MessageSelectionApi {
  /** Активен ли режим выбора сообщений в открытом чате. */
  messageSelection: Ref<boolean>
  /** Id выбранных сообщений. */
  selectedMessageIds: Ref<number[]>
  /** Выбраны ли все загруженные сообщения (кроме отметок о звонках). */
  allVisibleMessagesSelected: ComputedRef<boolean>
  /** Выбранные сообщения целиком. */
  selectedMessagesOf: () => Message[]
  /** Выход из режима выбора. */
  exitMessageSelection: () => void
  /** Вход: удержание на сообщении включает режим и выбирает его. */
  startMessageSelection: (message: Message) => void
  /** Клик по сообщению в режиме выбора — отметить/снять. */
  toggleMessageSelect: (message: Message) => void
  /** «Выбрать все» / снять выбор со всех. */
  toggleSelectAllMessages: () => void
  /** «Переслать» выбранные — открыть диалог выбора чатов. */
  bulkForwardMessages: () => void
  /** Сохранить выбранные в «Сохранённые сообщения» (свой чат). */
  bulkSaveMessagesToSelf: () => Promise<void>
  /** Удалить выбранные: «у меня» для любых, «для всех» — если всё выбранное своё. */
  bulkDeleteMessages: () => Promise<void>
}

/** Отметка о звонке — не сообщение: её не выбирают (в ленте это строка «Звонок»). */
const selectable = (messages: Message[]): Message[] => messages.filter((m) => m.kind !== 'call')

export function useMessageSelection(deps: MessageSelectionDeps): MessageSelectionApi {
  const messageSelection = ref(false)
  const selectedMessageIds = ref<number[]>([])

  const selectedMessagesOf = (): Message[] =>
    deps.messages().filter((m) => selectedMessageIds.value.includes(m.id))

  /** Выход из режима выбора сообщений. */
  const exitMessageSelection = (): void => {
    messageSelection.value = false
    selectedMessageIds.value = []
    deps.closeEmojiPicker()
  }

  /** Вход: удержание на сообщении включает режим и выбирает его. */
  const startMessageSelection = (message: Message): void => {
    if (message.kind === 'call') return
    messageSelection.value = true
    selectedMessageIds.value = [message.id]
    // Режим выбора — поверх остальных слоёв строки: меню, реакции, ответ, правка и
    // пересылка больше не нужны, а их подсказки мешали бы отмечать.
    deps.closePopups()
    deps.clearReply()
    if (deps.isEditing()) deps.cancelEditing()
    if (deps.isForwarding()) deps.cancelForward()
  }

  /** Клик по сообщению в режиме выбора — отметить/снять. */
  const toggleMessageSelect = (message: Message): void => {
    if (!messageSelection.value || message.kind === 'call') return
    const next = new Set(selectedMessageIds.value)
    if (next.has(message.id)) {
      next.delete(message.id)
    } else {
      next.add(message.id)
    }
    selectedMessageIds.value = Array.from(next)
    // Сняли последнее — режим выбора заканчивается сам.
    if (selectedMessageIds.value.length === 0) exitMessageSelection()
  }

  const allVisibleMessagesSelected = computed<boolean>(() => {
    const rows = selectable(deps.messages())
    return rows.length > 0 && rows.every((m) => selectedMessageIds.value.includes(m.id))
  })

  const toggleSelectAllMessages = (): void => {
    if (allVisibleMessagesSelected.value) {
      exitMessageSelection()
      return
    }
    selectedMessageIds.value = selectable(deps.messages()).map((m) => m.id)
  }

  const bulkForwardMessages = (): void => {
    const sources = selectable(selectedMessagesOf())
    if (sources.length === 0) return
    exitMessageSelection()
    deps.openForward(sources)
  }

  const bulkSaveMessagesToSelf = async (): Promise<void> => {
    const selfChat = deps.chats().find((chat) => chat.is_self)
    const current = deps.selectedChat()
    // Сохранять «в себя», уже стоя в «Сохранённых», нечего.
    if (!selfChat || (current !== null && current.is_self)) return
    const targets = selectable(selectedMessagesOf())
    exitMessageSelection()
    if (targets.length === 0) return
    try {
      for (const message of targets) {
        await forwardMessage(message.id, selfChat.id)
      }
      // Обновляем список: «Сохранённые» поднимутся наверх с новым превью.
      await deps.reloadChats()
    } catch (error) {
      console.error(t('Не удалось сохранить сообщения:'), getErrorMessage(error))
    }
  }

  const bulkDeleteMessages = async (): Promise<void> => {
    const targets = selectable(selectedMessagesOf())
    if (targets.length === 0) return
    // «Для всех» возможно, только когда ВСЁ выбранное — мои сообщения: удалять
    // чужое у всех нельзя (сервер отвечает 403), а половину — только у меня.
    const canForAll = targets.every((message) => message.user_id === deps.currentUserId())
    const scope = await deps.askDeleteScope({ count: targets.length, canForAll })
    if (scope === null) return
    exitMessageSelection()
    for (const message of targets) {
      try {
        await deleteMessage(message.id, scope === 'all')
        deps.removeMessageFromThread(message.id)
      } catch (error) {
        console.error(t('Не удалось удалить сообщение:'), getErrorMessage(error))
      }
    }
    const chatId = deps.selectedChatId()
    if (chatId !== null) {
      await Promise.all([deps.reloadPinned(chatId), deps.reloadChats()])
    }
  }

  return {
    messageSelection,
    selectedMessageIds,
    allVisibleMessagesSelected,
    selectedMessagesOf,
    exitMessageSelection,
    startMessageSelection,
    toggleMessageSelect,
    toggleSelectAllMessages,
    bulkForwardMessages,
    bulkSaveMessagesToSelf,
    bulkDeleteMessages
  }
}
