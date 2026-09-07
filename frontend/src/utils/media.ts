/** Утилиты определения и описания вложений сообщений. */

import type { Message, MessageFile } from '@/types'

export const isImageFile = (file: MessageFile): boolean => file.mime?.startsWith('image/') ?? false

export const isAudioFile = (file: MessageFile): boolean => file.mime?.startsWith('audio/') ?? false

export const isVideoFile = (file: MessageFile): boolean => file.mime?.startsWith('video/') ?? false

/** Видео, записанное через кнопку «видеосообщение» (имя файла video_*), — кружок. */
export const isRecordedVideoMessage = (file: MessageFile): boolean =>
  isVideoFile(file) && (file.name.toLowerCase().startsWith('video_') ?? false)

/** Пузырь, содержащий только кружок-видео (без текста/ответа), — без фона. */
export const isRoundVideoOnly = (message: Message): boolean =>
  !!message.file &&
  isRecordedVideoMessage(message.file) &&
  !message.text &&
  message.reply_to_id == null

export const mediaTypeLabel = (file: MessageFile): string => {
  if (isImageFile(file)) return 'Изображение'
  if (isAudioFile(file)) return 'Голосовое сообщение'
  if (isVideoFile(file)) return 'Видеосообщение'
  return `Файл: ${file.name}`
}

/**
 * Material-имя иконки вложения (для `<q-icon :name="fileIcon(file)" />`).
 */
export const fileIcon = (file: MessageFile): string => {
  if (file.mime?.startsWith('image/')) return 'image'
  if (file.mime?.startsWith('video/')) return 'videocam'
  if (file.mime === 'application/pdf') return 'picture_as_pdf'
  if (file.mime?.startsWith('audio/')) return 'volume_up'
  if (file.mime?.startsWith('text/')) return 'description'
  return 'insert_drive_file'
}

/** Краткое описание сообщения для цитат, превью и закреплённых. */
export const messageSnippet = (message: Message): string => {
  if (message.file) {
    if (isImageFile(message.file)) return '📷 Изображение'
    if (isAudioFile(message.file)) return '🎤 Голосовое'
    if (isVideoFile(message.file)) return '🎥 Видео'
    return `📎 ${message.file.name}`
  }
  return message.text || ''
}
