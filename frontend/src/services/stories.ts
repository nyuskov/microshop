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

/** Сводка по одному эмодзи: сколько человек поставили и моя ли это реакция. */
export interface StoryReactionSummary {
  emoji: string
  count: number
  mine: boolean
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
  /** Реакции, сгруппированные по эмодзи (сначала популярные). */
  reactions: StoryReactionSummary[]
}

/** Истории одного автора. */
export interface StoryGroup {
  user: StoryAuthor
  items: StoryItem[]
  has_unseen: boolean
  is_mine: boolean
}

/** Лента вместе с набором реакций, который задаёт сервер. */
export interface StoryFeed {
  groups: StoryGroup[]
  /** Допустимые эмодзи (порядок = порядок кнопок в панели). */
  reactionKinds: string[]
  /** Сколько кнопок показывать сразу, остальные — под «ещё». */
  reactionsPrimary: number
}

/** Кто поставил конкретный эмодзи (видит только автор истории). */
export interface StoryReactionAudience {
  emoji: string
  users: StoryAuthor[]
}

/** Аудитория своей истории: кто смотрел и кто как отреагировал. */
export interface StoryAudience {
  views: StoryAuthor[]
  /** Всего просмотров — может быть больше, чем имён в списке. */
  views_total: number
  reactions: StoryReactionAudience[]
}

/**
 * Запасной набор реакций: нужен только чтобы панель не оказалась пустой, если
 * сервер по какой-то причине не прислал `reaction_kinds` (старый бэкенд, кэш
 * ответа). Источник правды — серверный список в `api_v1/stories/reactions.py`.
 */
export const FALLBACK_STORY_REACTIONS = [
  '❤️',
  '🔥',
  '😂',
  '😮',
  '😢',
  '👏',
  '🙏',
  '👍',
  '💯',
  '🎉',
  '🤔',
  '🥰'
]

/** Размер «быстрого» ряда по умолчанию (если сервер не прислал свой). */
export const FALLBACK_STORY_REACTIONS_PRIMARY = 5

/** Лента: свои истории сверху, далее остальные; плюс набор реакций. */
export const fetchStories = async (): Promise<StoryFeed> => {
  const response = await api.get<{
    groups?: StoryGroup[]
    reaction_kinds?: string[]
    reactions_primary?: number
  }>('/stories/')
  const kinds = response.data.reaction_kinds ?? []
  return {
    groups: response.data.groups ?? [],
    reactionKinds: kinds.length > 0 ? kinds : [...FALLBACK_STORY_REACTIONS],
    reactionsPrimary: response.data.reactions_primary || FALLBACK_STORY_REACTIONS_PRIMARY
  }
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

/**
 * Ставит или снимает реакцию на чужую историю.
 *
 * Переключением занимается сервер: повторный вызов с тем же эмодзи её снимает,
 * а ответ содержит актуальную сводку — клиенту не нужно угадывать результат.
 */
export const reactToStory = async (storyId: number, emoji: string): Promise<StoryItem> => {
  const response = await api.post<StoryItem>(`/stories/${storyId}/react/`, { emoji })
  return response.data
}

/** Удаляет свою историю. */
export const deleteStory = async (storyId: number): Promise<void> => {
  await api.delete(`/stories/${storyId}/`)
}

/**
 * Аудитория своей истории: кто смотрел и кто как отреагировал.
 *
 * Отдаётся только автору (список зрителей — персональные данные), поэтому
 * вызывать имеет смысл лишь для своей истории — см. `StoryViewer.vue`.
 */
export const fetchStoryAudience = async (storyId: number): Promise<StoryAudience> => {
  const response = await api.get<StoryAudience>(`/stories/${storyId}/audience/`)
  return response.data
}
