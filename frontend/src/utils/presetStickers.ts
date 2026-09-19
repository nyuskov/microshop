/**
 * Метка набора в имени файла стикера.
 *
 * Зачем: в Телеграме по стикеру можно открыть его набор и добавить ЦЕЛИКОМ — там
 * сервер знает набор у каждого стикера. У нас стикер уходит сообщением как
 * обычная картинка (новая загрузка), и из чего он — непонятно. Поэтому имя файла
 * несёт метку, а она видна и в сообщении (`file.name`), и в расшифрованном конверте
 * E2EE (там настоящее имя лежит внутри шифротекста):
 *
 * - `st-<ключ набора>-<имя>.png` — ВСТРОЕННЫЙ набор приложения (статика в `public/`);
 * - `sp-<id пака>-<позиция>.png` — набор с СЕРВЕРА: свой или публичный. Для
 *   получателя узнаётся только публичный — чужой личный набор ему недоступен.
 *
 * По этим меткам окно набора (`components/messenger/StickerSetDialog.vue`) понимает,
 * что показать по тапу на стикер, а меню сообщения — что предложить добавить.
 */

import { STANDARD_STICKER_PACKS, type StandardStickerPack } from '@/utils/standardStickers'

const SET_PREFIX = 'st-'
const PACK_PREFIX = 'sp-'

/** Имя файла для стикера из предустановленного набора. */
export const presetStickerFileName = (setKey: string, name: string): string =>
  `${SET_PREFIX}${setKey}-${name}.png`

/**
 * Имя файла для стикера из набора на СЕРВЕРЕ (свой или публичный).
 *
 * `<имя>` — позиция стикера в паке: само по себе оно ничего не значит, важно только
 * то, что с ним вместе едет id пака.
 */
export const packStickerFileName = (packId: number, name: string): string =>
  `${PACK_PREFIX}${packId}-${name}.png`

/** Ключ набора из имени файла или null (свой стикер, обычное вложение). */
export const presetSetKeyOfFileName = (fileName: string | null | undefined): string | null => {
  if (!fileName || !fileName.startsWith(SET_PREFIX)) return null
  const [key] = fileName.slice(SET_PREFIX.length).split('-')
  if (!key) return null
  return STANDARD_STICKER_PACKS.some((pack) => pack.key === key) ? key : null
}

/** id серверного пака из имени файла или null (метки нет). */
export const packIdOfFileName = (fileName: string | null | undefined): number | null => {
  if (!fileName || !fileName.startsWith(PACK_PREFIX)) return null
  const [raw] = fileName.slice(PACK_PREFIX.length).split('-')
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Набор по ключу (или null, если ключ неизвестен — старая версия, свои стикеры). */
export const presetSetOfKey = (key: string | null | undefined): StandardStickerPack | null => {
  if (!key) return null
  return STANDARD_STICKER_PACKS.find((pack) => pack.key === key) ?? null
}

/** Набор, из которого пришёл стикер-сообщение (null — не из предустановленного). */
export const presetSetOfFileName = (
  fileName: string | null | undefined
): StandardStickerPack | null => presetSetOfKey(presetSetKeyOfFileName(fileName))
