import { describe, expect, it } from 'vitest'
import type { StoryGroup, StoryItem } from '@/services/stories'
import {
  findStoryIndex,
  flattenStories,
  formatStoryAge,
  groupProgress,
  isVideoStory,
  nextStory,
  previousStory
} from '@/utils/stories'

const story = (id: number, viewed = false, views = 0): StoryItem => ({
  id,
  media_url: `/media/${id}.jpg`,
  media_name: `${id}.jpg`,
  mime_type: 'image/jpeg',
  caption: null,
  created_at: '2026-09-10T10:00:00Z',
  expires_at: '2026-09-11T10:00:00Z',
  viewed,
  views
})

const group = (userId: number, ids: number[], isMine = false): StoryGroup => ({
  user: {
    id: userId,
    username: `u${userId}`,
    first_name: null,
    last_name: null,
    avatar_url: null
  },
  items: ids.map((id) => story(id)),
  has_unseen: true,
  is_mine: isMine
})

describe('flattenStories', () => {
  it('разворачивает группы в плоский список по порядку', () => {
    const flat = flattenStories([group(1, [10, 11]), group(2, [20])])
    expect(flat.map((item) => item.story.id)).toEqual([10, 11, 20])
    expect(flat[2].groupIndex).toBe(1)
    expect(flat[2].itemIndex).toBe(0)
  })

  it('находит позицию по id истории', () => {
    const flat = flattenStories([group(1, [10, 11])])
    expect(findStoryIndex(flat, 11)).toBe(1)
    expect(findStoryIndex(flat, 99)).toBeNull()
  })
})

describe('переходы между историями', () => {
  const flat = flattenStories([group(1, [10, 11]), group(2, [20, 21])])

  it('внутри группы идёт к следующей истории', () => {
    expect(nextStory(flat, flat[0])?.story.id).toBe(11)
  })

  it('в конце группы переходит к следующей группе', () => {
    expect(nextStory(flat, flat[1])?.story.id).toBe(20)
  })

  it('в конце ленты возвращает null (значит, закрывать)', () => {
    expect(nextStory(flat, flat[3])).toBeNull()
  })

  it('назад в начале группы открывает предыдущую группу с первой истории', () => {
    expect(previousStory(flat, flat[2])?.story.id).toBe(10)
  })

  it('назад на самой первой истории остаётся на ней', () => {
    expect(previousStory(flat, flat[0])?.story.id).toBe(10)
  })
})

describe('groupProgress', () => {
  it('для чужих считает просмотренные', () => {
    const mine = group(1, [10, 11])
    mine.items[0].viewed = true
    expect(groupProgress(mine)).toEqual({ total: 2, seen: 1 })
  })

  it('для своих считает истории с чужими просмотрами', () => {
    const my = group(1, [10, 11], true)
    my.items[1].views = 3
    expect(groupProgress(my)).toEqual({ total: 2, seen: 1 })
  })
})

describe('formatStoryAge', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('только что', () => {
    expect(formatStoryAge('2026-09-10T11:59:40Z', now)).toBe('только что')
  })

  it('минуты, часы и дни', () => {
    expect(formatStoryAge('2026-09-10T11:35:00Z', now)).toBe('25 мин')
    expect(formatStoryAge('2026-09-10T09:00:00Z', now)).toBe('3 ч')
    expect(formatStoryAge('2026-09-09T10:00:00Z', now)).toBe('1 дн')
  })

  it('не падает на мусоре', () => {
    expect(formatStoryAge('нет даты', now)).toBe('')
  })
})

describe('isVideoStory', () => {
  it('отличает видео от картинки', () => {
    expect(isVideoStory('video/mp4')).toBe(true)
    expect(isVideoStory('image/jpeg')).toBe(false)
    expect(isVideoStory(null)).toBe(false)
  })
})
