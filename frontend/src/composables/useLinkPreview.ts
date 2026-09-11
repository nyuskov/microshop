/**
 * Карточка внешней ссылки в сообщении: сама подтягивает данные и показывает
 * только удачный результат (если сайт недоступен — ничего не появляется).
 */

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { LinkPreview } from '@/types'
import { firstLinkInText } from '@/utils/linkPreview'
import { fetchLinkPreview } from '@/services/linkPreview'

export interface UseLinkPreviewResult {
  /** Данные карточки (null — ссылки нет или превью не собралось). */
  preview: Ref<LinkPreview | null>
}

/**
 * Следит за текстом сообщения и подгружает карточку первой ссылки.
 *
 * @param getText текст сообщения (функция, а не значение: текст меняется —
 *   сообщения редактируются, приходят обновления из realtime)
 */
export function useLinkPreview(getText: () => string | null | undefined): UseLinkPreviewResult {
  const preview = ref<LinkPreview | null>(null)
  // Номер последнего запроса: ответ на устаревший текст не должен перебивать
  // карточку актуального (сообщение могли отредактировать).
  let requestId = 0

  watch(
    () => firstLinkInText(getText()),
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

  onBeforeUnmount(() => {
    // После размонтирования ответ уже не нужен.
    requestId += 1
  })

  return { preview }
}
