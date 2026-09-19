/**
 * «Добавить весь набор» — как «ДОБАВИТЬ СТИКЕРЫ» в Телеграме.
 *
 * Встроенные наборы приложения лежат статикой (`utils/standardStickers.ts`), у
 * сервера их нет, поэтому добавление — это скачать картинки и загрузить их своим
 * паком (см. `stores/stickers.ts::importStandardSet`). Логика одна на два места:
 * окно «Мои стикеры» и панель стикеров в поле ввода, — поэтому она здесь, а не в
 * компонентах.
 *
 * Прогресс отдаём наружу: набор — это десятки отдельных загрузок, и без счётчика
 * кнопка выглядела бы зависшей. Отдельно показываем ожидание лимита: сервер
 * принимает 10 загрузок в минуту, поэтому на 11-м стикере набора пауза около
 * минуты — «Добавляем 10 из 16» без пояснения выглядело бы зависанием.
 */

import { computed, ref, type Ref } from 'vue'

import { useStickersStore } from '@/stores/stickers'
import type { StandardStickerPack } from '@/utils/standardStickers'

export interface StandardSetImportApi {
  /** Ключ набора, который сейчас добавляем (null — ничего не происходит). */
  importingKey: Ref<string | null>
  /** Сколько стикеров уже обработано из общего числа. */
  progress: Ref<{ done: number; total: number }>
  /** Сколько секунд осталось ждать лимит загрузок (0 — не ждём). */
  waitingSeconds: Ref<number>
  /** Идёт добавление: кнопки остальных наборов на это время гасим. */
  isImporting: Ref<boolean>
  /** Подпись кнопки: «Добавить набор», прогресс или ожидание лимита. */
  label: (set: StandardStickerPack) => string
  /**
   * Добавляет набор целиком.
   *
   * Возвращает текст ошибки или пустую строку: где её показать, решает вызывающий
   * (в окне — строкой под списком, в панели — всплывающей плашкой).
   */
  run: (set: StandardStickerPack) => Promise<string>
}

export function useStandardSetImport(): StandardSetImportApi {
  const store = useStickersStore()

  const importingKey = ref<string | null>(null)
  const progress = ref({ done: 0, total: 0 })
  const waitingSeconds = ref(0)
  const isImporting = computed(() => importingKey.value !== null)

  const label = (set: StandardStickerPack): string => {
    if (importingKey.value !== set.key) return 'Добавить набор'
    const done = `Добавляем ${progress.value.done} из ${progress.value.total}`
    if (waitingSeconds.value > 0) {
      return `Ждём лимит загрузок (${waitingSeconds.value} с) · ${done}`
    }
    return `${done}…`
  }

  const run = async (set: StandardStickerPack): Promise<string> => {
    if (importingKey.value !== null) return ''
    importingKey.value = set.key
    progress.value = { done: 0, total: set.stickers.length }
    waitingSeconds.value = 0
    try {
      const result = await store.importStandardSet(
        set,
        (done, total) => {
          progress.value = { done, total }
        },
        (seconds) => {
          waitingSeconds.value = seconds
        }
      )
      if (result.failed > 0) {
        // Пак остался в библиотеке, но отметки «Добавлен» нет: набор можно
        // добавить ещё раз, а часть стикеров уже на месте.
        return `Добавлено ${result.added} из ${set.stickers.length}: часть стикеров не загрузилась. Набор можно добавить ещё раз.`
      }
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Не удалось добавить набор'
    } finally {
      importingKey.value = null
      waitingSeconds.value = 0
    }
  }

  return { importingKey, progress, waitingSeconds, isImporting, label, run }
}
