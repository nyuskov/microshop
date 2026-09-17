/** Стор стикеров: мои паки, загрузка картинок и «Недавние». */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  createStickerPack,
  deleteSticker,
  deleteStickerPack,
  fetchStickerLibrary,
  updateStickerPack,
  uploadSticker,
  type StickerItem,
  type StickerPack
} from '@/services/stickers'
import {
  readRecentStickerIds,
  rememberStickerId,
  STICKER_IMAGE_RECENT_KEY,
  STICKER_IMAGE_RECENT_LIMIT
} from '@/utils/emoji'

export const useStickersStore = defineStore('stickers', () => {
  const packs = ref<StickerPack[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  /** Недавние стикеры — по id: удалённый стикер исчезает из «Недавних» сам. */
  const recentIds = ref<number[]>(readRecentStickerIds(globalThis.localStorage))

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
    reset
  }
})
