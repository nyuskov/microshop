/** Утилиты определения и описания вложений сообщений. */

import type { Message, MessageFile } from '@/types'
import { isEncryptedPayload } from '@/services/e2ee'

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
  if (message.encrypted && isEncryptedPayload(message.text)) return '🔒 Сообщение'
  if (message.file) {
    if (isImageFile(message.file)) return '📷 Изображение'
    if (isAudioFile(message.file)) return '🎤 Голосовое'
    if (isVideoFile(message.file)) return '🎥 Видео'
    return `📎 ${message.file.name}`
  }
  return message.text || ''
}

// ---------- Клиентская оптимизация фото перед загрузкой ----------
/** Максимальная сторона фото после пережатия (меньше — быстрее грузится). */
const IMAGE_MAX_EDGE = 1600
/** Порог размера, с которого фото считаем «крупным» и пережимаем. */
const IMAGE_LARGE_BYTES = 900 * 1024
const IMAGE_JPEG_QUALITY = 0.82

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('read error'))
    reader.readAsDataURL(file)
  })

const loadHtmlImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'))
    img.src = src
  })

/**
 * Пережимает фото на клиенте перед отправкой (камера/галерея): если фото
 * крупное (>~0.9 МБ или сторона больше 1600px), оно уменьшается и сжимается
 * в JPEG/PNG — загрузка становится заметно быстрее. GIF и мелкие файлы
 * возвращаются без изменений.
 */
export async function optimizeImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  const isBig = file.size > IMAGE_LARGE_BYTES
  try {
    const img = await loadHtmlImage(await readFileAsDataUrl(file))
    const isLarge = Math.max(img.width, img.height) > IMAGE_MAX_EDGE
    if (!isBig && !isLarge) return file
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(img.width, img.height))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, width, height)
    const keepPng = file.type === 'image/png'
    const outType = keepPng ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), outType, keepPng ? undefined : IMAGE_JPEG_QUALITY)
    )
    if (!blob) return file
    const ext = keepPng ? 'png' : 'jpg'
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.${ext}`, { type: outType })
  } catch {
    return file
  }
}
