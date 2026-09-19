/**
 * Метка предустановленного набора в имени файла стикера.
 *
 * Зачем: в Телеграме, удерживая стикер, можно добавить ВЕСЬ набор, из которого он
 * пришёл — сервер там знает набор у каждого стикера. У нас предустановленные
 * наборы лежат статикой приложения, и когда стикер уходит сообщением, сервер
 * видит только картинку: из какого она набора — непонятно. Поэтому имя файла
 * несёт метку `st-<ключ набора>-<имя>.png`, а она уже видна и в сообщении
 * (`file.name`), и в расшифрованном конверте E2EE (там настоящее имя лежит
 * внутри шифротекста).
 *
 * Отсюда меню стикера понимает, что предложить «Добавить набор «Работа»».
 * Свои стикеры человека метки не имеют — для них набора для добавления нет.
 */

import { STANDARD_STICKER_PACKS, type StandardStickerPack } from '@/utils/standardStickers'

const SET_PREFIX = 'st-'

/** Имя файла для стикера из предустановленного набора. */
export const presetStickerFileName = (setKey: string, name: string): string =>
  `${SET_PREFIX}${setKey}-${name}.png`

/** Ключ набора из имени файла или null (свой стикер, обычное вложение). */
export const presetSetKeyOfFileName = (fileName: string | null | undefined): string | null => {
  if (!fileName || !fileName.startsWith(SET_PREFIX)) return null
  const [key] = fileName.slice(SET_PREFIX.length).split('-')
  if (!key) return null
  return STANDARD_STICKER_PACKS.some((pack) => pack.key === key) ? key : null
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
