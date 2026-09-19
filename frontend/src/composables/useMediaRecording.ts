/**
 * Голосовые и видеосообщения (кружки): открытие модалок записи, отправка
 * записанного как обычного вложения (общий `uploadRecordedMedia`).
 *
 * Вынесено из `Messenger.vue`: сценарий самостоятельный — «открыть модалку
 * записи → зашифровать при необходимости → отправить как вложение → обновить
 * ленту и список чатов». Ленте остаются только побочные эффекты, которые
 * передаются опциями.
 */

import { ref, onScopeDispose, type Ref } from 'vue'
import { mediaFileName, type RecordedMedia } from '@/services/recorder'
import { sendAttachmentMessage } from '@/services/chatService'
import { encryptFileForChat } from '@/services/e2eeFiles'
import { getErrorMessage } from '@/services/errors'
import type { PeerActivityKind } from '@/utils/peerActivity'
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
  /**
   * Сообщить собеседнику, что идёт занятие (запись, отправка): возвращает
   * функцию «закончили». Одно событие живёт недолго, поэтому реализация сама
   * повторяет его, пока занятие не закончится.
   */
  beginActivity: (chatId: number, kind: PeerActivityKind) => () => void
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

  /**
   * Пока идёт запись, собеседник должен видеть «записывает голосовое…»: держим
   * функцию «закончили», чтобы погасить подпись при отмене/отправке.
   */
  let recordActivityStop: (() => void) | null = null

  const beginRecordActivity = (kind: PeerActivityKind) => {
    finishRecordActivity()
    const chatId = options.selectedChatId()
    if (chatId === null) return
    recordActivityStop = options.beginActivity(chatId, kind)
  }

  const finishRecordActivity = () => {
    recordActivityStop?.()
    recordActivityStop = null
  }

  onScopeDispose(finishRecordActivity)

  const uploadRecordedMedia = async (payload: RecordedMedia, kind: 'voice' | 'video') => {
    const chatId = options.selectedChatId()
    if (chatId === null) return
    options.setSendingFile(true)
    options.setSendError('')
    // Запись закончилась, но файл ещё грузится: подпись меняется на «отправляет…».
    const finishUploadActivity = options.beginActivity(chatId, kind === 'voice' ? 'file' : 'video')
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
      options.appendToThread(message)
      await Promise.all([options.loadPinned(chatId), options.refreshChats()])
      options.scrollToBottom()
    } catch (error) {
      options.removePendingUpload(localId)
      options.setSendError(getErrorMessage(error, 'Не удалось отправить медиасообщение'))
    } finally {
      finishUploadActivity()
      options.setSendingFile(false)
    }
  }

  const openVoiceRec = () => {
    options.prepare()
    voiceRecOpen.value = true
    beginRecordActivity('voice')
  }

  const onVoiceCancel = () => {
    voiceRecOpen.value = false
    finishRecordActivity()
  }

  const onVoiceSend = async (payload: RecordedMedia) => {
    voiceRecOpen.value = false
    finishRecordActivity()
    await uploadRecordedMedia(payload, 'voice')
  }

  const openVideoRec = () => {
    options.prepare()
    videoRecOpen.value = true
    beginRecordActivity('video_note')
  }

  const onVideoCancel = () => {
    videoRecOpen.value = false
    options.resetRecordMode()
    finishRecordActivity()
  }

  const onVideoSend = async (payload: RecordedMedia) => {
    videoRecOpen.value = false
    options.resetRecordMode()
    finishRecordActivity()
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
