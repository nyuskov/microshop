/**
 * Набор, из которого пришёл стикер: что показать в окне по тапу на стикер.
 *
 * Стикер в сообщении — просто картинка; набор узнаём по метке в имени файла
 * (`utils/presetStickers.ts`):
 *
 * - `st-…` — встроенный набор приложения (статика, добавляется скачиванием картинок);
 * - `sp-<id>` — набор с сервера: свой (`own: true`, добавлять нечего) или публичный
 *   (у него работает «Добавить весь набор» одним запросом).
 *
 * Модуль без Pinia: так его и окно набора, и тесты могут звать напрямую, а списки
 * паков приходят аргументами.
 */

import { mediaUrl } from '@/config'
import { STANDARD_STICKER_PACKS } from '@/utils/standardStickers'
import { packIdOfFileName, presetSetOfFileName } from '@/utils/presetStickers'
import type { StickerPack } from '@/services/stickers'

/** Стикер набора для сетки в окне. */
export interface StickerSetImage {
  url: string
  mime: string
  alt: string
  /** Имя внутри набора — уезжает в метку файла при отправке из окна. */
  name: string
}

/** Набор, который показываем в окне. */
export interface StickerSetRef {
  /** Встроенный набор приложения или набор с сервера. */
  kind: 'standard' | 'server'
  title: string
  images: StickerSetImage[]
  /** Ключ встроенного набора (`kind: 'standard'`). */
  setKey?: string
  /** id серверного пака (`kind: 'server'`). */
  packId?: number
  /** Пак мой: он уже в библиотеке, добавлять нечего. */
  own: boolean
}

const standardSetRef = (setKey: string): StickerSetRef | null => {
  const set = STANDARD_STICKER_PACKS.find((pack) => pack.key === setKey)
  if (!set) return null
  return {
    kind: 'standard',
    title: set.title,
    setKey: set.key,
    own: false,
    images: set.stickers.map((sticker) => ({
      url: sticker.url,
      mime: 'image/png',
      alt: sticker.label,
      name: sticker.name
    }))
  }
}

const serverSetRef = (pack: StickerPack, own: boolean): StickerSetRef => ({
  kind: 'server',
  title: pack.title,
  packId: pack.id,
  own,
  images: pack.stickers.map((sticker) => ({
    url: mediaUrl(sticker.file_url),
    mime: sticker.mime_type ?? 'image/webp',
    alt: 'Стикер',
    // Позиция как имя: само по себе оно ничего не значит, но с ним едет id пака.
    name: String(sticker.position)
  }))
})

/**
 * Набор по имени файла стикера.
 *
 * `packs` — библиотека человека (его наборы), `presets` — публичные наборы с
 * сервера. Свой пак ищем первым: он у человека точно есть, а публичный мог быть
 * снят с публикации.
 */
export const resolveStickerSet = (
  fileName: string | null | undefined,
  packs: StickerPack[],
  presets: StickerPack[]
): StickerSetRef | null => {
  const setKey = presetSetOfFileName(fileName)?.key
  if (setKey) return standardSetRef(setKey)
  const packId = packIdOfFileName(fileName)
  if (packId === null) return null
  const mine = packs.find((pack) => pack.id === packId)
  if (mine) return serverSetRef(mine, true)
  const preset = presets.find((pack) => pack.id === packId)
  return preset ? serverSetRef(preset, false) : null
}

/**
 * Стикер, готовый к отправке: ссылка на байты плюс метка набора.
 *
 * Метку в имя файла превращает `Messenger.vue::sendStickerImage` — там же, где
 * собирается отправка стикера из панели.
 */
export interface StickerSendRef {
  url: string
  mime: string
  /** Встроенный набор приложения: уедет меткой `st-<набор>-<имя>.png`. */
  preset?: { setKey: string; name: string }
  /** Набор с сервера: уедет меткой `sp-<id>-<имя>.png`. */
  pack?: { packId: number; position: number }
}

/** Стикер из окна набора → отправка (ссылка плюс метка набора). */
export const stickerSendRef = (set: StickerSetRef, image: StickerSetImage): StickerSendRef => {
  if (set.kind === 'standard' && set.setKey) {
    return { url: image.url, mime: image.mime, preset: { setKey: set.setKey, name: image.name } }
  }
  if (set.packId !== undefined) {
    return {
      url: image.url,
      mime: image.mime,
      pack: { packId: set.packId, position: Number(image.name) }
    }
  }
  // Набор известен по названию, но не по метке (например, свой пак без id) —
  // отправляем как обычный стикер.
  return { url: image.url, mime: image.mime }
}
