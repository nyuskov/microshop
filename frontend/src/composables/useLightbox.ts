/**
 * Полноэкранный просмотр изображений (лайтбокс).
 *
 * Вынесено из `Messenger.vue`: кадры, текущий индекс и листание — это
 * самостоятельная единица, а лента отдаёт только данные. Лайтбокс — слой
 * интерфейса, поэтому открытие помечается в истории приложения (системная
 * «назад» должна закрывать просмотр, а не уводить из чата).
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { Message } from '@/types'
import { buildLightboxItems, neighborIndexes, type LightboxItem } from '@/utils/lightbox'

export interface UseLightboxOptions {
  /** Сообщения открытой ленты (кадры собираются по ним). */
  messages: () => readonly Message[]
  /**
   * Ссылка на кадр. Обязана только ЧИТАТЬ готовность: расшифровка запрашивается
   * ниже, иначе при каждом рендере ленты скачивались бы все изображения истории.
   */
  urlOf: (message: Message) => string
  /** Попросить расшифровку кадра (текущего и соседей). */
  prepare: (message: Message) => void
  /** Нужна ли подготовка (расшифровка) этому кадру. */
  needsPrepare: (message: Message) => boolean
  /** Лайтбокс открывается — отметить слой в истории приложения. */
  onOpen: () => void
}

export interface UseLightbox {
  /** Кадры в порядке ленты. */
  items: ComputedRef<LightboxItem[]>
  /** Текущий кадр (`null` — просмотр закрыт). */
  index: Ref<number | null>
  /** Открыть просмотр на изображении из этого сообщения. */
  open: (message: Message) => void
  close: () => void
  /** Листание по кругу: -1 — назад, +1 — вперёд. */
  step: (delta: number) => void
}

export function useLightbox(options: UseLightboxOptions): UseLightbox {
  const items = computed(() => buildLightboxItems(options.messages(), options.urlOf))
  const index = ref<number | null>(null)

  // Расшифровываем текущий кадр и соседей — листание без ожидания.
  watch([index, items], () => {
    const current = index.value
    if (current === null) return
    for (const i of neighborIndexes(current, items.value.length)) {
      const item = items.value[i]
      if (item && options.needsPrepare(item.message)) options.prepare(item.message)
    }
  })

  const open = (message: Message) => {
    if (items.value.length === 0) return
    const found = items.value.findIndex((item) => item.id === message.id)
    options.onOpen()
    index.value = found >= 0 ? found : 0
  }

  const close = () => {
    index.value = null
  }

  const step = (delta: number) => {
    if (index.value === null || items.value.length === 0) return
    const length = items.value.length
    index.value = (index.value + delta + length) % length
  }

  return { items, index, open, close, step }
}
