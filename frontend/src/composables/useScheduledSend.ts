/**
 * Отложенная отправка («отправить позже»): что ждёт своего часа и её отмена.
 *
 * Очередь живёт на СЕРВЕРЕ — её разбирает Celery beat, поэтому сообщение уйдёт и с
 * закрытым приложением (таймер в браузере такого не даёт). Здесь только клиентская
 * часть: список отложенных открытого чата и создание/отмена.
 *
 * Вынесено из `Messenger.vue`: это одна тема («что отправлю позже»), а мессенджер
 * только связывает её с полем ввода и панелью отложенных. Зависимости — геттерами
 * (объявлены ниже вызова, см. граблю TDZ в шапке файла), последствия отправки —
 * колбэками: composable не должен знать про черновики и «печатает…».
 */

import { ref, type Ref } from 'vue'
import { t } from '@/i18n'

import {
  cancelScheduledMessage,
  createScheduledMessage,
  fetchScheduledMessages
} from '@/services/chatService'
import { decryptText, encryptText } from '@/services/e2ee'
import { getErrorMessage } from '@/services/errors'
import type { Chat, ScheduledMessage } from '@/types'

export interface ScheduledSendDeps {
  /** Текст поля ввода: его и откладываем. */
  composerText: Ref<string>
  /** Флаг «отправка в полёте» — общий с обычной отправкой, чтобы не отправить дважды. */
  sending: Ref<boolean>
  selectedChat: () => Chat | null
  selectedChatId: () => number | null
  /** id сообщения, на которое отвечаем (уедет в отложенное сообщение). */
  replyToId: () => number | null
  /** Ключ чата для шифрования текста (null — чат не зашифрован). */
  chatKeyOf: (chat: Chat | null) => Promise<CryptoKey | null>
  /** Отложили: почистить черновик, снять ответ и погасить «печатает…». */
  onScheduled: (chatId: number) => void
  /** Не получилось — сообщить человеку. */
  onError: (message: string) => void
}

export function useScheduledSend(deps: ScheduledSendDeps) {
  /** Отложенные сообщения открытого чата (по возрастанию времени). */
  const scheduledMessages = ref<ScheduledMessage[]>([])
  /** Расшифрованные тексты отложенных (id → текст): в E2EE-чате на сервере шифр. */
  const scheduledDecrypted = ref<Record<number, string>>({})

  /**
   * Подтягивает отложенные сообщения чата.
   *
   * В зашифрованном чате текст на сервере — шифротекст: расшифровываем его для
   * предпросмотра, а если ключа ещё нет (или строку писал клиент другой версии) —
   * список покажет «Зашифрованное сообщение» вместо мусора.
   */
  const loadScheduled = async (chatId: number): Promise<void> => {
    try {
      const rows = await fetchScheduledMessages(chatId)
      scheduledMessages.value = rows
      const decrypted: Record<number, string> = {}
      const aes = await deps.chatKeyOf(deps.selectedChat())
      if (aes) {
        for (const row of rows) {
          if (!row.encrypted) continue
          const text = await decryptText(aes, row.text)
          if (text !== null) decrypted[row.id] = text
        }
      }
      scheduledDecrypted.value = decrypted
    } catch {
      // Список отложенных — вспомогательный: без него чат работает как обычно.
      scheduledMessages.value = []
      scheduledDecrypted.value = {}
    }
  }

  /** Другой чат: отложенные прошлого чата больше не нужны. */
  const resetScheduled = (): void => {
    scheduledMessages.value = []
    scheduledDecrypted.value = {}
  }

  const scheduleSend = async (sendAt: string): Promise<void> => {
    const chatId = deps.selectedChatId()
    const text = deps.composerText.value.trim()
    if (chatId === null || !text) return

    deps.sending.value = true
    try {
      // Шифруем так же, как обычную отправку: открытый текст не должен уезжать на
      // сервер, даже если сообщение уйдёт через час.
      let wireText = text
      let wireEncrypted = false
      const aes = await deps.chatKeyOf(deps.selectedChat())
      if (aes) {
        wireText = await encryptText(aes, text)
        wireEncrypted = true
      }
      await createScheduledMessage({
        chat_id: chatId,
        text: wireText,
        send_at: sendAt,
        reply_to_id: deps.replyToId(),
        encrypted: wireEncrypted
      })
      deps.composerText.value = ''
      deps.onScheduled(chatId)
      await loadScheduled(chatId)
    } catch (error) {
      deps.onError(getErrorMessage(error, t('Не удалось отложить сообщение')))
    } finally {
      deps.sending.value = false
    }
  }

  const cancelScheduled = async (scheduledId: number): Promise<void> => {
    const chatId = deps.selectedChatId()
    try {
      await cancelScheduledMessage(scheduledId)
    } catch (error) {
      deps.onError(getErrorMessage(error, t('Не удалось отменить отправку')))
    } finally {
      if (chatId !== null) await loadScheduled(chatId)
    }
  }

  return {
    scheduledMessages,
    scheduledDecrypted,
    loadScheduled,
    resetScheduled,
    scheduleSend,
    cancelScheduled
  }
}
