/**
 * Карточки внешних ссылок (превью сайта, как в Telegram).
 *
 * Ссылку разбирает сервер (он же скачивает картинку к нам в media) — здесь
 * только запрос и кэш в памяти страницы: одна и та же ссылка в списке чатов,
 * в открытой нити и после перерисовки не должна запрашиваться заново.
 *
 * Серверный кэш живёт в БД (неделю), так что «сходить ещё раз» — редкий случай.
 */

import { api } from './api'
import type { LinkPreview } from '@/types'

/** Запросы по адресу: и готовые ответы, и «в пути» (чтобы не дублировать). */
const requests = new Map<string, Promise<LinkPreview | null>>()

/**
 * Возвращает карточку ссылки.
 *
 * Никогда не бросает: при сбое сети/сервера отдаёт `null`, и карточка просто не
 * появляется — сообщение важнее превью.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const pending = requests.get(url)
  if (pending) return pending

  const request = api
    .post<LinkPreview>('/link-preview/', { url })
    .then((response) => response.data ?? null)
    .catch(() => {
      // Неудачу не кэшируем: следующий показ попробует снова.
      requests.delete(url)
      return null
    })

  requests.set(url, request)
  return request
}

/** Сбрасывает кэш страницы (например, при выходе из аккаунта). */
export function clearLinkPreviewCache(): void {
  requests.clear()
}
