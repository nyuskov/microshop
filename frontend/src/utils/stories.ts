/**
 * Навигация по историям: плоский список и переходы «вперёд/назад».
 *
 * Вынесено из компонента просмотрщика, чтобы это можно было проверить тестами:
 * здесь вся арифметика границ (конец группы → следующая группа, конец ленты →
 * закрыть просмотрщик), а не разметка.
 */

import type { StoryGroup, StoryItem } from '@/services/stories'

/** История вместе с её автором (для сквозного показа «все подряд»). */
export interface FlatStory {
  author: StoryGroup['user']
  isMine: boolean
  story: StoryItem
  groupIndex: number
  itemIndex: number
}

/** Плоский список историй в порядке показа (группы уже отсортированы сервером). */
export function flattenStories(groups: StoryGroup[]): FlatStory[] {
  const flat: FlatStory[] = []
  groups.forEach((group, groupIndex) => {
    group.items.forEach((story, itemIndex) => {
      flat.push({
        author: group.user,
        isMine: group.is_mine,
        story,
        groupIndex,
        itemIndex
      })
    })
  })
  return flat
}

/**
 * Позиция истории в плоском списке; `null` — если такой истории нет (её могли
 * удалить/истечь, пока просмотрщик был открыт).
 */
export function findStoryIndex(flat: FlatStory[], storyId: number): number | null {
  const index = flat.findIndex((entry) => entry.story.id === storyId)
  return index >= 0 ? index : null
}

/**
 * Следующая история. Внутри группы — следующий элемент, на последнем элементе —
 * первая история следующей группы. `null` — лента закончилась.
 */
export function nextStory(flat: FlatStory[], current: FlatStory): FlatStory | null {
  const index = findStoryIndex(flat, current.story.id)
  if (index === null) return null
  return flat[index + 1] ?? null
}

/**
 * Предыдущая история. На первом элементе группы возвращаемся к началу
 * предыдущей группы (там показываем её с начала — как в мессенджерах).
 */
export function previousStory(flat: FlatStory[], current: FlatStory): FlatStory | null {
  const index = findStoryIndex(flat, current.story.id)
  if (index === null) return null
  if (index === 0) return flat[0] ?? null
  const previous = flat[index - 1]
  // Начало группы — не «прыгаем» внутрь неё, а показываем её первую историю.
  if (previous.groupIndex !== current.groupIndex) {
    const firstOfGroup = flat.findIndex((entry) => entry.groupIndex === previous.groupIndex)
    return flat[firstOfGroup] ?? previous
  }
  return previous
}

/** Сколько всего историй у автора и сколько из них уже просмотрено (для полоски). */
export function groupProgress(group: StoryGroup): { total: number; seen: number } {
  const total = group.items.length
  const seen = group.is_mine
    ? group.items.filter((story) => story.views > 0).length
    : group.items.filter((story) => story.viewed).length
  return { total, seen }
}

/** «5 мин», «3 ч», «2 дн» — сколько живёт история (для подписи под аватаркой). */
export function formatStoryAge(createdAt: string, now: Date = new Date()): string {
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - created.getTime()) / 1000))
  if (seconds < 60) return 'только что'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч`
  return `${Math.round(hours / 24)} дн`
}

/** Идёт ли ещё видео/картинка (для прогресс-полоски истории). */
export function isVideoStory(mimeType: string | null): boolean {
  return Boolean(mimeType?.startsWith('video/'))
}
