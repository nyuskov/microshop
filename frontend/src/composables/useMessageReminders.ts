/**
 * Напоминания о сообщении («напомнить мне»).
 *
 * Второй сценарий отложенного действия: «верни меня к этой строке». Живёт на
 * сервере (напоминание должно сработать с закрытым приложением — доставка push),
 * а клиент хранит только список напоминаний открытого чата: по нему строка
 * показывает значок у времени, а меню — «Изменить напоминание».
 *
 * Вынесено из `Messenger.vue`: это одна тема (что напомнить и когда), а мессенджер
 * только связывает её с лентой сообщений и диалогом. Зависимости — геттерами: в
 * `<script setup>` мессенджера они объявлены ниже вызова, и обращение к ним на
 * этапе setup дало бы TDZ.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { t } from '@/i18n'

import {
  cancelMessageReminder,
  createMessageReminder,
  fetchMessageReminders
} from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'
import type { Message, MessageReminder } from '@/types'

/** Длина подписи сообщения в диалоге: дольше в одну строку не поместится. */
const PREVIEW_MAX = 120

export interface MessageRemindersDeps {
  /** id открытого чата (null — чат не выбран): напоминания читаем по нему. */
  selectedChatId: () => number | null
  /** Куда сообщить о неудаче (в мессенджере — баннер над лентой). */
  onError: (message: string) => void
}

export interface MessageRemindersApi {
  /** Напоминания открытого чата. */
  reminders: Ref<MessageReminder[]>
  /** Сообщение, для которого открыт диалог напоминания. */
  reminderTarget: Ref<Message | null>
  /** Запрос в полёте: кнопки диалога временно недоступны. */
  reminderBusy: Ref<boolean>
  /** Напоминание по id сообщения (null — его нет). */
  reminderFor: (messageId: number) => MessageReminder | null
  /** Время напоминания по id сообщения — для значка в строке (`MessageThread`). */
  reminderAtOf: (message: Message) => string | null
  /** Начало текста сообщения для диалога (в E2EE — нейтральная подпись). */
  reminderPreview: ComputedRef<string>
  /** Подтянуть напоминания чата (ошибку глотаем, см. ниже). */
  loadReminders: (chatId: number) => Promise<void>
  /** Другой чат: напоминания прошлого больше не нужны. */
  resetReminders: () => void
  /** Открыть диалог напоминания для сообщения (из меню строки). */
  openReminderDialog: (message: Message) => void
  /** Сохранить (или перенести) напоминание в выбранное время. */
  saveReminder: (remindAt: string) => Promise<void>
  /** Снять напоминание у выбранного сообщения. */
  removeReminder: () => Promise<void>
  /** Закрыть диалог (крестик, Esc, клик мимо). */
  closeReminderDialog: () => void
}

export function useMessageReminders(deps: MessageRemindersDeps): MessageRemindersApi {
  const reminders = ref<MessageReminder[]>([])
  const reminderTarget = ref<Message | null>(null)
  const reminderBusy = ref(false)

  const reminderFor = (messageId: number): MessageReminder | null =>
    reminders.value.find((item) => item.message_id === messageId) ?? null

  const reminderAtOf = (message: Message): string | null =>
    reminderFor(message.id)?.remind_at ?? null

  const reminderPreview = computed(() => {
    const message = reminderTarget.value
    if (!message) return ''
    if (message.file && !message.text) return t('Вложение')
    const text = (message.text ?? '').trim().replace(/\s+/g, ' ')
    if (!text) return message.file ? t('Вложение') : ''
    return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text
  })

  /**
   * Подтягивает напоминания чата.
   *
   * Список вспомогательный: без него чат работает как обычно (значка у времени не
   * будет, а поставить напоминание всё равно можно) — поэтому ошибку глотаем.
   */
  const loadReminders = async (chatId: number): Promise<void> => {
    try {
      reminders.value = await fetchMessageReminders(chatId)
    } catch {
      reminders.value = []
    }
  }

  const resetReminders = (): void => {
    reminders.value = []
  }

  const closeReminderDialog = (): void => {
    reminderTarget.value = null
  }

  const openReminderDialog = (message: Message): void => {
    if (message.kind === 'call') return
    reminderTarget.value = message
  }

  const saveReminder = async (remindAt: string): Promise<void> => {
    const message = reminderTarget.value
    const chatId = deps.selectedChatId()
    if (!message || chatId === null) return
    reminderBusy.value = true
    try {
      await createMessageReminder(message.id, remindAt)
      reminderTarget.value = null
      await loadReminders(chatId)
    } catch (error) {
      deps.onError(getErrorMessage(error, t('Не удалось поставить напоминание')))
    } finally {
      reminderBusy.value = false
    }
  }

  const removeReminder = async (): Promise<void> => {
    const message = reminderTarget.value
    const chatId = deps.selectedChatId()
    if (!message) return
    const existing = reminderFor(message.id)
    if (!existing) {
      reminderTarget.value = null
      return
    }
    reminderBusy.value = true
    try {
      await cancelMessageReminder(existing.id)
      reminderTarget.value = null
      if (chatId !== null) await loadReminders(chatId)
    } catch (error) {
      deps.onError(getErrorMessage(error, t('Не удалось убрать напоминание')))
    } finally {
      reminderBusy.value = false
    }
  }

  return {
    reminders,
    reminderTarget,
    reminderBusy,
    reminderFor,
    reminderAtOf,
    reminderPreview,
    loadReminders,
    resetReminders,
    openReminderDialog,
    saveReminder,
    removeReminder,
    closeReminderDialog
  }
}
