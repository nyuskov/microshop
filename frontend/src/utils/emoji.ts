/**
 * Эмодзи и стикеры: правила «крупного» рендера, «крупные» эмодзи-стикеры и память
 * о недавних.
 *
 * Каталог эмодзи лежит отдельно — `utils/emojiCatalog.ts` (он генерируется из
 * списка Unicode), а здесь — только правила и память панели.
 *
 * «Крупный» рендер: сообщение из одних эмодзи (1–3 штуки) показывается без
 * пузыря и большим размером, как стикер в Telegram. Это ещё и способ отправлять
 * «стикеры» без отдельного знборника: один тап в панели — и эмодзи уходит
 * сообщением.
 */

export interface EmojiGroup {
  key: string
  title: string
  items: string[]
}

/** Ключ localStorage со списком недавних эмодзи (по устройству). */
export const EMOJI_RECENT_KEY = 'pismo_emoji_recent'

/** Сколько недавних храним. */
export const EMOJI_RECENT_LIMIT = 16

/** Ключ localStorage со списком недавних СТИКЕРОВ-КАРТИНОК (по устройству). */
export const STICKER_IMAGE_RECENT_KEY = 'pismo_sticker_image_recent'

/** Сколько недавних стикеров-картинок храним: два ряда в панели. */
export const STICKER_IMAGE_RECENT_LIMIT = 16

/** Ключ localStorage со списком недавних «крупных» эмодзи-стикеров. */
export const STICKER_RECENT_KEY = 'pismo_sticker_recent'

/** Сколько недавних эмодзи-стикеров храним: сетка из двух рядов. */
export const STICKER_RECENT_LIMIT = 16

/**
 * Насколько крупно рисовать сообщение из эмодзи.
 *
 * `text` — обычный пузырь (есть буквы/цифры или эмодзи больше трёх),
 * `large` — три эмодзи, `huge` — один-два: так же, как в Telegram.
 */
export type EmojiLayout = 'text' | 'large' | 'huge'

/** Больше трёх эмодзи в строку — это уже текст, а не стикер. */
export const EMOJI_STICKER_MAX = 3

/**
 * Одна эмодзи-последовательность: флаг, keycap, либо пиктограмма с
 * модификатором и ZWJ-связками (семья, профессии).
 */
const EMOJI_SEQUENCE =
  /\p{RI}\p{RI}|[\d#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu

/** Сколько эмодзи-последовательностей в строке (флаг = один, семья = один). */
export const emojiCount = (text: string): number => text.match(EMOJI_SEQUENCE)?.length ?? 0

/**
 * Состоит ли сообщение ТОЛЬКО из эмодзи (пробелы и переводы строк не мешают).
 *
 * Важно для «крупного» рендера: если помимо эмодзи есть буквы или знаки
 * препинания, сообщение остаётся обычным текстом — иначе «привет 🙂» внезапно
 * превращалось бы в стикер.
 */
export const isEmojiOnly = (text: string): boolean => {
  const rest = text.replace(EMOJI_SEQUENCE, '').replace(/[\s\uFE0F]/g, '')
  return rest.length === 0 && emojiCount(text) > 0
}

/** Как рисовать текст сообщения: как текст, крупно или очень крупно. */
export const emojiLayout = (text: string): EmojiLayout => {
  if (!isEmojiOnly(text)) return 'text'
  const count = emojiCount(text)
  if (count === 0) return 'text'
  if (count > EMOJI_STICKER_MAX) return 'text'
  return count <= 2 ? 'huge' : 'large'
}

/** Читает недавние эмодзи из хранилища (устойчиво к мусору внутри). */
export function readRecentEmoji(storage: Storage | undefined): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(EMOJI_RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .slice(0, EMOJI_RECENT_LIMIT)
  } catch {
    // Битое значение в localStorage не должно ломать ввод сообщения.
    return []
  }
}

/** Добавляет эмодзи в начало недавних без дублей и обрезает до лимита. */
export function rememberEmoji(recent: string[], emoji: string): string[] {
  return [emoji, ...recent.filter((item) => item !== emoji)].slice(0, EMOJI_RECENT_LIMIT)
}

/**
 * Недавние стикеры.
 *
 * Отдельный список от эмодзи: в панели эмодзи выбор вставляет символ в текст
 * (там важна история набора), а стикер сразу уходит сообщением — смешивать их
 * в одной памяти значило бы путать два разных действия.
 */
export function readRecentStickers(storage: Storage | undefined): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STICKER_RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string' && emojiCount(item) > 0)
      .slice(0, STICKER_RECENT_LIMIT)
  } catch {
    return []
  }
}

/** Запоминает отправленный эмодзи-стикер (в начало, без дублей). */
export function rememberSticker(recent: string[], sticker: string): string[] {
  return [sticker, ...recent.filter((item) => item !== sticker)].slice(0, STICKER_RECENT_LIMIT)
}

/**
 * Недавние стикеры-картинки — по id, а не по ссылке.
 *
 * Так удалённый стикер сам исчезает из «Недавних»: список сверяется с
 * библиотекой, и битой ссылки в панели не бывает.
 */
export function readRecentStickerIds(storage: Storage | undefined): number[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STICKER_IMAGE_RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
      .slice(0, STICKER_IMAGE_RECENT_LIMIT)
  } catch {
    // Битое значение в localStorage не должно ломать панель стикеров.
    return []
  }
}

/** Запоминает отправленный стикер-картинку (в начало, без дублей). */
export function rememberStickerId(recent: number[], stickerId: number): number[] {
  return [stickerId, ...recent.filter((item) => item !== stickerId)].slice(
    0,
    STICKER_IMAGE_RECENT_LIMIT
  )
}
