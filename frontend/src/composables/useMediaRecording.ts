/**
 * Голосовые и видеосообщения (кружки): открытие модалок записи, отправка
 * записанного как обычного вложения (общий `uploadRecordedMedia`).
 *
 * Вынесено из `Messenger.vue`: сценарий самостоятельный — «открыть модалку
 * записи → зашифровать при необходимости → отправить как вложение → обновить
 * ленту и список чатов». Ленте остаются только побочные эффекты, которые
 * передаются опциями.
 */

import { ref, type Ref } from 'vue'
import { mediaFileName, type RecordedMedia } from '@/services/recorder'
import { sendAttachmentMessage } from '@/services/chatService'
import { encryptFileForChat } from '@/services/e2eeFiles'
import { getErrorMessage } from '@/services/errors'
import type { Chat, EncryptedFileMeta, Message } from '@/types'

export interface UseMediaRecordingOptions {
  /** Какой чат открыт сейчас. */
  selectedChatId: () => number | null
  /** Открытый чат целиком — нужен для ключа шифрования. */
  selectedChat: () => Chat | null
  /** Id сообщения, на которое отвечаем (если есть). */
  replyToId: () => number | undefined
  /** Подготовка перед записью: закрыть поповеры. */
  prepare: () => void
  /** Сбросить режим кнопки записи (аудио/видео) после отмены/отправки. */
  resetRecordMode: () => void
  /** Ключ чата для шифрования вложения (null — чат не зашифрован). */
  chatKeyOf: (chat: Chat | null) => Promise<CryptoKey | null>
  /** Создать временный пузырь «Отправка…» и получить его localId. */
  addPendingUpload: (label: string) => number
  /** Убрать временный пузырь (успех, ошибка). */
  removePendingUpload: (localId: number) => void
  /** Обновить процент загрузки пузыря. */
  setPendingProgress: (localId: number, percent: number) => void
  /** Ещё существует ли пузырь (не убрали по другой причине раньше ответа). */
  hasPendingUpload: (localId: number) => boolean
  /** Подставить локально расшифрованный конверт отправленного файла. */
  applyLocalFileEnvelope: (message: Message, meta: EncryptedFileMeta) => void
  /** Добавить сообщение в открытую ленту (без дублей). */
  appendToThread: (message: Message) => void
  /** Перечитать закреплённые сообщения чата. */
  loadPinned: (chatId: number) => Promise<void>
  /** Перечитать список чатов. */
  refreshChats: () => Promise<void>
  /** Сбросить панель ответа (reply). */
  clearReply: () => void
  /** Сообщить собеседнику, что печатать закончили. */
  stopTyping: (chatId: number) => void
  /** Прокрутить ленту вниз (после добавления временного/настоящего пузыря). */
  scrollToBottom: () => void
  /** Дождаться следующего тика перед прокруткой. */
  nextTick: (callback: () => void) => void
  /** Идёт отправка вложения — блокирует повторную отправку из composer'а. */
  setSendingFile: (value: boolean) => void
  /** Текст ошибки отправки. */
  setSendError: (message: string) => void
}

export interface UseMediaRecording {
  /** Открыта ли модалка записи голоса. */
  voiceRecOpen: Ref<boolean>
  /** Открыта ли модалка записи видео (кружок). */
  videoRecOpen: Ref<boolean>
  openVoiceRec: () => void
  onVoiceCancel: () => void
  onVoiceSend: (payload: RecordedMedia) => Promise<void>
  openVideoRec: () => void
  onVideoCancel: () => void
  onVideoSend: (payload: RecordedMedia) => Promise<void>
}

export function useMediaRecording(options: UseMediaRecordingOptions): UseMediaRecording {
  const voiceRecOpen = ref(false)
  const videoRecOpen = ref(false)

  const uploadRecordedMedia = async (payload: RecordedMedia, kind: 'voice' | 'video') => {
    const chatId = options.selectedChatId()
    if (chatId === null) return
    options.setSendingFile(true)
    options.setSendError('')
    // Голосовое/видео тоже показываем временным пузырём с прогрессом:
    // длинная запись грузится не мгновенно.
    const label = kind === 'voice' ? 'Голосовое сообщение' : 'Видеосообщение'
    const localId = options.addPendingUpload(label)
    options.nextTick(options.scrollToBottom)
    try {
      const file = new File([payload.blob], mediaFileName(kind, payload.mime), {
        type: payload.mime
      })
      // Голосовые и кружки шифруются так же, как обычные вложения.
      const aes = await options.chatKeyOf(options.selectedChat())
      const encrypted = aes ? await encryptFileForChat(aes, file) : null
      const message = await sendAttachmentMessage(
        chatId,
        encrypted ? encrypted.blob : file,
        encrypted ? encrypted.text : '',
        options.replyToId(),
        (percent) => {
          if (options.hasPendingUpload(localId)) {
            options.setPendingProgress(localId, percent)
          }
        },
        !!encrypted
      )
      if (encrypted) options.applyLocalFileEnvelope(message, encrypted.meta)
      options.removePendingUpload(localId)
      options.clearReply()
      options.stopTyping(chatId)
      options.appendToThread(message)
      await Promise.all([options.loadPinned(chatId), options.refreshChats()])
      options.scrollToBottom()
    } catch (error) {
      options.removePendingUpload(localId)
      options.setSendError(getErrorMessage(error, 'Не удалось отправить медиасообщение'))
    } finally {
      options.setSendingFile(false)
    }
  }

  const openVoiceRec = () => {
    options.prepare()
    voiceRecOpen.value = true
  }

  const onVoiceCancel = () => {
    voiceRecOpen.value = false
  }

  const onVoiceSend = async (payload: RecordedMedia) => {
    voiceRecOpen.value = false
    await uploadRecordedMedia(payload, 'voice')
  }

  const openVideoRec = () => {
    options.prepare()
    videoRecOpen.value = true
  }

  const onVideoCancel = () => {
    videoRecOpen.value = false
    options.resetRecordMode()
  }

  const onVideoSend = async (payload: RecordedMedia) => {
    videoRecOpen.value = false
    options.resetRecordMode()
    await uploadRecordedMedia(payload, 'video')
  }

  return {
    voiceRecOpen,
    videoRecOpen,
    openVoiceRec,
    onVoiceCancel,
    onVoiceSend,
    openVideoRec,
    onVideoCancel,
    onVideoSend
  }
}
