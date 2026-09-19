/** Стор стикеров: мои паки, загрузка картинок и «Недавние». */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  createStickerPack,
  deleteSticker,
  deleteStickerPack,
  fetchStickerLibrary,
  fetchStandardStickerFile,
  updateStickerPack,
  uploadSticker,
  uploadRetryAfterSeconds,
  type StickerItem,
  type StickerPack
} from '@/services/stickers'
import {
  readRecentStickerIds,
  rememberStickerId,
  STICKER_IMAGE_RECENT_KEY,
  STICKER_IMAGE_RECENT_LIMIT
} from '@/utils/emoji'
import type { StandardStickerPack } from '@/utils/standardStickers'

/**
 * Какие встроенные наборы человек уже добавил себе: ключ набора → id пака.
 *
 * Отметка нужна, чтобы кнопка «Добавить набор» не предлагала добавить его
 * повторно (как в Телеграме: набор уже в коллекции). Храним именно отметку, а не
 * сверяем название пака: человек мог пак переименовать, и совпадение имён ничего
 * не значит. Если пак удалили — отметка перестаёт действовать, и набор можно
 * добавить заново.
 */
const IMPORTED_SETS_KEY = 'pismo_sticker_imports'

/** Сколько раз пережидаем лимит загрузок, прежде чем сдаться (10 файлов в минуту). */
const UPLOAD_MAX_ATTEMPTS = 8

const readImportedSets = (): Record<string, number> => {
  try {
    const raw = globalThis.localStorage?.getItem(IMPORTED_SETS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number'
      )
    )
  } catch {
    return {}
  }
}

export const useStickersStore = defineStore('stickers', () => {
  const packs = ref<StickerPack[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  /** Недавние стикеры — по id: удалённый стикер исчезает из «Недавних» сам. */
  const recentIds = ref<number[]>(readRecentStickerIds(globalThis.localStorage))

  /** Встроенные наборы, которые человек уже добавил себе (ключ → id пака). */
  const importedSets = ref<Record<string, number>>(readImportedSets())

  const persistImportedSets = (): void => {
    try {
      globalThis.localStorage?.setItem(IMPORTED_SETS_KEY, JSON.stringify(importedSets.value))
    } catch {
      // Приватный режим/переполнение: отметка не переживёт перезапуск —
      // человек просто увидит кнопку «Добавить набор» ещё раз.
    }
  }

  /**
   * Набор уже добавлен себе?
   *
   * Отметка перестаёт действовать, если пак удалили: набор можно добавить заново,
   * поэтому проверяем ещё и наличие пака в библиотеке.
   */
  const isStandardSetImported = (setKey: string): boolean => {
    const packId = importedSets.value[setKey]
    return packId !== undefined && packs.value.some((pack) => pack.id === packId)
  }

  /** Все стикеры человека — для поиска по id и «Недавних». */
  const all = computed<StickerItem[]>(() => packs.value.flatMap((pack) => pack.stickers))

  const isEmpty = computed(() => all.value.length === 0)

  const stickerById = (id: number): StickerItem | undefined =>
    all.value.find((item) => item.id === id)

  /** Недавние: только те, что ещё живы в библиотеке. */
  const recent = computed<StickerItem[]>(() =>
    recentIds.value
      .map((id) => stickerById(id))
      .filter((item): item is StickerItem => item !== undefined)
  )

  const sortPacks = (list: StickerPack[]): StickerPack[] =>
    list.slice().sort((a, b) => a.position - b.position || a.id - b.id)

  const sortStickers = (list: StickerItem[]): StickerItem[] =>
    list.slice().sort((a, b) => a.position - b.position || a.id - b.id)

  /** Загружает библиотеку (повторно — только по требованию). */
  const load = async (force = false): Promise<void> => {
    if (loading.value || (loaded.value && !force)) return
    loading.value = true
    try {
      packs.value = sortPacks(await fetchStickerLibrary())
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  const replace = (pack: StickerPack): void => {
    const index = packs.value.findIndex((item) => item.id === pack.id)
    if (index === -1) {
      packs.value = [...packs.value, pack]
      return
    }
    const next = packs.value.slice()
    next[index] = pack
    packs.value = next
  }

  /** Создаёт пак и ставит его последним. */
  const createPack = async (title = 'Мои стикеры'): Promise<StickerPack> => {
    const pack = await createStickerPack(title)
    packs.value = sortPacks([...packs.value, { ...pack, stickers: pack.stickers ?? [] }])
    return pack
  }

  /** Переименование пака (пустое название сервер заменит на «Мои стикеры»). */
  const renamePack = async (packId: number, title: string): Promise<void> => {
    replace(await updateStickerPack(packId, { title }))
  }

  /** Удаляет пак вместе со стикерами. */
  const removePack = async (packId: number): Promise<void> => {
    await deleteStickerPack(packId)
    packs.value = packs.value.filter((pack) => pack.id !== packId)
    // Пак был добавленным встроенным набором — снимаем отметку, чтобы человек
    // мог добавить набор заново (иначе кнопка осталась бы «Добавлен»).
    const rest = Object.entries(importedSets.value).filter(([, id]) => id !== packId)
    if (rest.length !== Object.keys(importedSets.value).length) {
      importedSets.value = Object.fromEntries(rest)
      persistImportedSets()
    }
  }

  /**
   * Меняет порядок паков местами с соседом.
   *
   * Позиции уезжают на сервер парой: иначе после перезагрузки панель вернулась
   * бы к прежнему порядку. Оптимистично переставляем сразу — панель не должна
   * ждать сети.
   */
  const movePack = async (packId: number, delta: -1 | 1): Promise<void> => {
    const ordered = sortPacks(packs.value)
    const index = ordered.findIndex((pack) => pack.id === packId)
    const target = index + delta
    if (index === -1 || target < 0 || target >= ordered.length) return
    const current = ordered[index]
    const neighbour = ordered[target]
    const swap: StickerPack[] = ordered.slice()
    swap[index] = neighbour
    swap[target] = current
    packs.value = swap.map((pack, position) => ({ ...pack, position }))
    await Promise.all([
      updateStickerPack(current.id, { position: neighbour.position }),
      updateStickerPack(neighbour.id, { position: current.position })
    ])
  }

  /** Загружает картинку в пак и запоминает её в «Недавних». */
  const addSticker = async (packId: number, file: File): Promise<StickerItem> => {
    const sticker = await uploadSticker(packId, file)
    const pack = packs.value.find((item) => item.id === packId)
    if (pack) {
      replace({ ...pack, stickers: sortStickers([...pack.stickers, sticker]) })
    } else {
      await load(true)
    }
    rememberRecent(sticker.id)
    return sticker
  }

  /** Убирает стикер из библиотеки (и из «Недавних» — он там больше не нужен). */
  const removeSticker = async (stickerId: number): Promise<void> => {
    await deleteSticker(stickerId)
    packs.value = packs.value.map((pack) => ({
      ...pack,
      stickers: pack.stickers.filter((item) => item.id !== stickerId)
    }))
    persistRecent(recentIds.value.filter((id) => id !== stickerId))
  }

  /** Ставит стикер первым в «Недавних» (последний отправленный — первым). */
  const rememberRecent = (stickerId: number): void => {
    persistRecent(rememberStickerId(recentIds.value, stickerId))
  }

  const persistRecent = (ids: number[]): void => {
    recentIds.value = ids.slice(0, STICKER_IMAGE_RECENT_LIMIT)
    try {
      globalThis.localStorage?.setItem(STICKER_IMAGE_RECENT_KEY, JSON.stringify(recentIds.value))
    } catch {
      // Приватный режим/переполнение: «Недавние» просто не переживут перезапуск.
    }
  }

  /** Сбрасывает состояние (выход из аккаунта). */
  const reset = (): void => {
    packs.value = []
    loaded.value = false
  }

  /**
   * Загружает стикер, пережидая лимит частоты загрузок.
   *
   * Сервер принимает 10 загрузок в минуту (`message_upload_limit_per_minute`), а
   * в наборе стикеров больше — на 11-м файле приходит 429 с `Retry-After`. Для
   * человека «добавить набор» — одно действие, поэтому ждём столько, сколько
   * просит сервер, и продолжаем: иначе набор приезжал бы наполовину, а часть
   * стикеров терялась бы молча.
   */
  const uploadStickerPacing = async (
    packId: number,
    file: File,
    onWait?: (seconds: number) => void
  ): Promise<StickerItem> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await uploadSticker(packId, file)
      } catch (cause) {
        const waitSeconds = uploadRetryAfterSeconds(cause)
        if (waitSeconds === null || attempt >= UPLOAD_MAX_ATTEMPTS) throw cause
        onWait?.(waitSeconds)
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
        onWait?.(0)
      }
    }
  }

  /**
   * Добавляет ВСТРОЕННЫЙ набор целиком — «ДОБАВИТЬ СТИКЕРЫ» как в Телеграме.
   *
   * Набор лежит статикой в приложении, у сервера его нет, поэтому картинки
   * скачиваются и загружаются обычным путём (`fetchStandardStickerFile`) —
   * дальше это обычный свой пак: его можно переименовать, переставить, удалить,
   * а стикеры из него отправляются как свои.
   *
   * Грузим ПО ОДНОМУ: сервер принимает файл на запрос, а параллельная пачка
   * только упиралась бы в лимит частоты и мешала прогрессу. Прогресс отдаём
   * наружу — человек видит «Добавляем 4 из 16», а не замерший экран.
   *
   * Отметку «набор добавлен» ставим только при полном успехе: иначе после
   * случайного сбоя кнопка сказала бы «Добавлен», а половины стикеров не было бы.
   */
  const importStandardSet = async (
    set: StandardStickerPack,
    onProgress?: (done: number, total: number) => void,
    /** Сообщает, сколько секунд ждём лимит загрузок (0 — ожидание закончилось). */
    onWait?: (seconds: number) => void
  ): Promise<{ pack: StickerPack; added: number; failed: number }> => {
    const pack = await createPack(set.title)
    const total = set.stickers.length
    let added = 0
    let failed = 0
    onProgress?.(0, total)
    for (const sticker of set.stickers) {
      try {
        const file = await fetchStandardStickerFile(sticker)
        const uploaded = await uploadStickerPacing(pack.id, file, onWait)
        const target = packs.value.find((item) => item.id === pack.id)
        if (target) {
          replace({ ...target, stickers: sortStickers([...target.stickers, uploaded]) })
        }
        added += 1
      } catch {
        failed += 1
      }
      onProgress?.(added + failed, total)
    }
    if (failed === 0) {
      importedSets.value = { ...importedSets.value, [set.key]: pack.id }
      persistImportedSets()
    }
    return { pack, added, failed }
  }

  return {
    packs,
    loading,
    loaded,
    recentIds,
    recent,
    all,
    isEmpty,
    stickerById,
    load,
    createPack,
    renamePack,
    removePack,
    movePack,
    addSticker,
    removeSticker,
    rememberRecent,
    isStandardSetImported,
    importStandardSet,
    reset
  }
})
