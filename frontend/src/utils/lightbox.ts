/**
 * Кадры для полноэкранного просмотра (лайтбокс).
 *
 * Список строится по всем изображениям истории, но БЕЗ запуска расшифровки:
 * `resolveUrl` только читает состояние, а расшифровку запрашивает тот, кто
 * показывает кадр. Иначе при открытии чата скачивались и расшифровывались бы
 * все изображения истории (трафик, AES на каждое вложение, blob-ссылки в
 * памяти) — ровно то, чего мы избегаем в ленте через `useVisibleOnce`.
 */

import type { Message } from '@/types'
import { t } from '@/i18n'
import { effectiveFile, isImageFile } from '@/utils/media'

export interface LightboxItem {
  id: number
  /** Ссылка на кадр. Пустая, пока зашифрованное вложение ещё расшифровывается. */
  url: string
  name: string
  /** Сообщение кадра: по нему лайтбокс просит расшифровку для текущего кадра. */
  message: Message
}

/**
 * Собирает кадры в порядке ленты.
 *
 * Список НЕ зависит от готовности расшифровки: иначе после каждого
 * расшифрованного вложения он бы рос, а индексы и «3 / 7» прыгали прямо во
 * время просмотра.
 */
export function buildLightboxItems(
  messages: readonly Message[],
  resolveUrl: (message: Message) => string
): LightboxItem[] {
  const items: LightboxItem[] = []
  for (const message of messages) {
    const attachment = effectiveFile(message)
    if (attachment === null || !isImageFile(attachment)) continue
    items.push({
      id: message.id,
      url: resolveUrl(message),
      name: attachment.name || t('Изображение'),
      message
    })
  }
  return items
}

/** Соседние кадры (текущий и по одному с каждой стороны) — для предзагрузки. */
export function neighborIndexes(index: number, length: number): number[] {
  if (length <= 0) return []
  const offsets = length === 1 ? [0] : [0, -1, 1]
  return offsets.map((offset) => (index + offset + length) % length)
}
