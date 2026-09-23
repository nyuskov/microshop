/**
 * Пересылка сообщений: выбор чатов, отправка, состояние диалога.
 *
 * Вынесено из `Messenger.vue`: это самостоятельный сценарий — «открыть диалог
 * выбора чатов → переслать в каждый → обновить ленту и список». Ленте остаются
 * только побочные эффекты (добавить сообщение в открытый чат, обновить
 * закреплённые, перечитать список чатов).
 */

import { ref, type Ref } from 'vue'
import { t } from '@/i18n'
import { forwardMessage } from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'
import type { Message } from '@/types'

export interface UseForwardOptions {
  /** Какой чат открыт сейчас (в него добавляем пересланное без перезагрузки). */
  selectedChatId: () => number | null
  /** Добавить сообщение в открытую ленту. */
  appendToThread: (message: Message) => void
  /** Перечитать закреплённые сообщения чата. */
  loadPinned: (chatId: number) => Promise<void>
  /** Перечитать список чатов: пересланные поднимутся наверх с новым превью. */
  refreshChats: () => Promise<void>
  /** Сообщить собеседнику, что печатать закончили. */
  stopTyping: (chatId: number) => void
  /** Подготовка к диалогу: закрыть поповеры и выйти из режима правки. */
  prepare: () => void
}

export interface UseForward {
  /** Что пересылаем: одно сообщение или несколько (режим выделения). */
  source: Ref<Message | Message[] | null>
  /** Идёт отправка — кнопка в диалоге показывает «Пересылаем…». */
  busy: Ref<boolean>
  /** Открыть диалог выбора чатов. */
  open: (message: Message | Message[]) => void
  /** Закрыть диалог и сбросить состояние. */
  cancel: () => void
  /** Переслать в выбранные чаты. */
  send: (chatIds: number[]) => Promise<void>
}

export function useForward(options: UseForwardOptions): UseForward {
  const source = ref<Message | Message[] | null>(null)
  const busy = ref(false)

  const open = (message: Message | Message[]) => {
    options.prepare()
    source.value = message
  }

  const cancel = () => {
    source.value = null
    busy.value = false
  }

  const send = async (chatIds: number[]) => {
    const value = source.value
    const sources = value ? (Array.isArray(value) ? value : [value]) : []
    if (sources.length === 0 || chatIds.length === 0) return
    busy.value = true
    try {
      for (const targetChatId of chatIds) {
        for (const item of sources) {
          const sent = await forwardMessage(item.id, targetChatId)
          if (options.selectedChatId() === targetChatId) options.appendToThread(sent)
        }
        options.stopTyping(targetChatId)
        if (options.selectedChatId() === targetChatId) await options.loadPinned(targetChatId)
      }
      await options.refreshChats()
      cancel()
    } catch (error) {
      console.error(t('Не удалось переслать сообщения:'), getErrorMessage(error))
      cancel()
    } finally {
      busy.value = false
    }
  }

  return { source, busy, open, cancel, send }
}
