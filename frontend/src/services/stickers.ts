/** Клиент API стикеров: паки, картинки и «в стикеры» из сообщения. */

import { api } from './api'

/** Один стикер в панели (файл отдаётся через `/media/...`). */
export interface StickerItem {
  id: number
  file_url: string
  mime_type: string | null
  position: number
}

/** Набор стикеров со содержимым: панель показывает пак целиком. */
export interface StickerPack {
  id: number
  title: string
  position: number
  stickers: StickerItem[]
}

/** Что сервер принимает и какого размера (`core/sticker_store.py`). */
export const STICKER_ACCEPT = 'image/png,image/webp,image/gif'
export const MAX_STICKER_BYTES = 512 * 1024
export const STICKER_ALLOWED_MIME = ['image/png', 'image/webp', 'image/gif']

/** Расширение по типу: сервер смотрит на имя файла, а не на Content-Type. */
export const stickerFileName = (file: File): string => {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (ext === 'png' || ext === 'webp' || ext === 'gif') return file.name
  if (file.type === 'image/gif') return 'sticker.gif'
  if (file.type === 'image/png') return 'sticker.png'
  return 'sticker.webp'
}

/** Мои паки со стикерами — этим живёт панель стикеров. */
export const fetchStickerLibrary = async (): Promise<StickerPack[]> => {
  const response = await api.get<{ packs?: StickerPack[] }>('/stickers/')
  return response.data.packs ?? []
}

/** Создаёт пак (название по умолчанию подставит сервер). */
export const createStickerPack = async (title = 'Мои стикеры'): Promise<StickerPack> => {
  const response = await api.post<StickerPack>('/stickers/packs/', { title })
  return response.data
}

/** Переименование и/или перемещение пака в панели. */
export const updateStickerPack = async (
  packId: number,
  patch: { title?: string; position?: number }
): Promise<StickerPack> => {
  const response = await api.patch<StickerPack>(`/stickers/packs/${packId}`, patch)
  return response.data
}

/** Удаляет пак вместе со стикерами. */
export const deleteStickerPack = async (packId: number): Promise<void> => {
  await api.delete(`/stickers/packs/${packId}`)
}

/**
 * Загружает стикер: тело запроса — байты картинки, имя — в параметрах.
 *
 * Сервер сам приводит картинку к виду (512 px, WebP), поэтому клиент не жмёт
 * её заранее: GIF от пересборки потерял бы анимацию.
 */
export const uploadSticker = async (packId: number, file: File): Promise<StickerItem> => {
  const response = await api.post<StickerItem>(`/stickers/packs/${packId}/items/`, file, {
    params: { filename: stickerFileName(file) },
    headers: { 'Content-Type': file.type || 'application/octet-stream' }
  })
  return response.data
}

/** Переносит стикер в другой пак и/или меняет позицию. */
export const updateSticker = async (
  stickerId: number,
  patch: { pack_id?: number; position?: number }
): Promise<StickerItem> => {
  const response = await api.patch<StickerItem>(`/stickers/items/${stickerId}`, patch)
  return response.data
}

/** Убирает стикер из библиотеки. */
export const deleteSticker = async (stickerId: number): Promise<void> => {
  await api.delete(`/stickers/items/${stickerId}`)
}

/**
 * «В стикеры» из сообщения: сервер сам скопирует картинку.
 *
 * В зашифрованном чате так нельзя (на сервере шифротекст) — там клиент шлёт уже
 * расшифрованные байты обычной загрузкой, см. `Messenger.vue`.
 */
export const stickerFromMessage = async (
  messageId: number,
  packId?: number
): Promise<StickerItem> => {
  const response = await api.post<StickerItem>('/stickers/from-message/', {
    message_id: messageId,
    pack_id: packId ?? null
  })
  return response.data
}
