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

export const fileIcon = (file: MessageFile): string => {
  if (file.mime?.startsWith('image/')) return 'pi pi-image'
  if (file.mime?.startsWith('video/')) return 'pi pi-video'
  if (file.mime === 'application/pdf') return 'pi pi-file-pdf'
  if (file.mime?.startsWith('audio/')) return 'pi pi-volume-up'
  if (file.mime?.startsWith('text/')) return 'pi pi-file'
  return 'pi pi-file'
}
