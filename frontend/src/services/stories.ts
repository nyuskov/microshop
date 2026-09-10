/** Клиент API историй (статусов). */

import { api } from './api'

/** Автор истории — данные для аватарки и подписи. */
export interface StoryAuthor {
  id: number
  username: string
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
}

/** Одна история (публикация). */
export interface StoryItem {
  id: number
  media_url: string
  media_name: string | null
  mime_type: string | null
  caption: string | null
  created_at: string
  expires_at: string
  /** Я уже посмотрел (для своей истории — есть ли чужие просмотры). */
  viewed: boolean
  /** Сколько раз смотрели. */
  views: number
}

/** Истории одного автора. */
export interface StoryGroup {
  user: StoryAuthor
  items: StoryItem[]
  has_unseen: boolean
  is_mine: boolean
}

/** Лента: свои истории сверху, далее остальные. */
export const fetchStories = async (): Promise<StoryGroup[]> => {
  const response = await api.get<{ groups: StoryGroup[] }>('/stories/')
  return response.data.groups
}

/** Публикует историю: файл уходит телом запроса, остальное — параметрами. */
export const publishStory = async (file: File, caption = ''): Promise<StoryItem> => {
  const response = await api.post<StoryItem>('/stories/', file, {
    params: {
      filename: file.name || 'story.jpg',
      mime: file.type || 'image/jpeg',
      caption
    },
    headers: { 'Content-Type': file.type || 'application/octet-stream' }
  })
  return response.data
}

/** Отмечает историю просмотренной (сервер вернёт обновлённую группу автора). */
export const viewStory = async (storyId: number): Promise<StoryGroup | null> => {
  const response = await api.post<StoryGroup | null>(`/stories/${storyId}/view/`)
  return response.data
}

/** Удаляет свою историю. */
export const deleteStory = async (storyId: number): Promise<void> => {
  await api.delete(`/stories/${storyId}/`)
}
