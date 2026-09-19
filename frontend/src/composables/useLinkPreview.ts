/**
 * Карточка внешней ссылки в сообщении: сама подтягивает данные и показывает
 * только удачный результат (если сайт недоступен — ничего не появляется).
 */

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { LinkPreview } from '@/types'
import { firstLinkInText } from '@/utils/linkPreview'
import { fetchLinkPreview } from '@/services/linkPreview'

export interface UseLinkPreviewResult {
  /** Данные карточки (null — ссылки нет или превью не собралось). */
  preview: Ref<LinkPreview | null>
}

export interface UseLinkPreviewOptions {
  /**
   * Можно ли уже запрашивать превью. По умолчанию — сразу.
   *
   * Обычно сюда передают «строка показалась на экране»
   * (`useVisibleOnce`), иначе карточки запрашивались бы для всей загруженной
   * истории: сервер по каждой ссылке ходит в интернет, а лимит — 30 запросов
   * в минуту на пользователя.
   */
  enabled?: () => boolean
}

/**
 * Следит за текстом сообщения и подгружает карточку первой ссылки.
 *
 * @param getText текст сообщения (функция, а не значение: текст меняется —
 *   сообщения редактируются, приходят обновления из realtime)
 * @param options `enabled` — разрешение на запрос (см. выше)
 */
export function useLinkPreview(
  getText: () => string | null | undefined,
  options: UseLinkPreviewOptions = {}
): UseLinkPreviewResult {
  const preview = ref<LinkPreview | null>(null)
  // Номер последнего запроса: ответ на устаревший текст не должен перебивать
  // карточку актуального (сообщение могли отредактировать).
  let requestId = 0

  /*
   * Наблюдатель — в `onMounted`: `watch` вычисляет источник сразу, а `getText`
   * и `enabled` обычно читают ref'ы, объявленные в `<script setup>` НИЖЕ
   * вызова, — иначе setup падает с «Cannot access 'x' before initialization»
   * (TDZ) и приложение показывает фатальный экран. Для карточки это значит,
   * что первый запрос уходит сразу после монтирования — на строку ленты это
   * один и тот же кадр.
   */
  onMounted(() => {
    watch(
      () => {
        if (options.enabled && !options.enabled()) return null
        return firstLinkInText(getText())
      },
      async (link) => {
        requestId += 1
        const currentRequest = requestId
        if (!link) {
          preview.value = null
          return
        }
        const result = await fetchLinkPreview(link)
        if (currentRequest !== requestId) return
        preview.value = result?.ok ? result : null
      },
      { immediate: true }
    )
  })

  onBeforeUnmount(() => {
    // После размонтирования ответ уже не нужен.
    requestId += 1
  })

  return { preview }
}
