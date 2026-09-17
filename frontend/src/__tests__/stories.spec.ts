import { describe, expect, it } from 'vitest'
import type {
  StoryAudience,
  StoryAuthor,
  StoryGroup,
  StoryItem,
  StoryReactionSummary
} from '@/services/stories'
import {
  audienceSections,
  audienceViewsHint,
  findStoryIndex,
  flattenStories,
  formatStoryAge,
  groupProgress,
  isVideoStory,
  nextStory,
  previousStory,
  quickReactions,
  reactionTotal,
  storyTapZone,
  toggleReaction
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
  views,
  reactions: []
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

const KINDS = ['❤️', '🔥', '😂', '👏', '👍']
const summary = (emoji: string, count: number, mine = false): StoryReactionSummary => ({
  emoji,
  count,
  mine
})

describe('toggleReaction', () => {
  it('ставит новую реакцию', () => {
    expect(toggleReaction([], '🔥', KINDS)).toEqual([summary('🔥', 1, true)])
  })

  it('добавляет свою к чужой такой же', () => {
    const result = toggleReaction([summary('🔥', 2)], '🔥', KINDS)
    expect(result).toEqual([summary('🔥', 3, true)])
  })

  it('снимает свою реакцию и уменьшает счётчик', () => {
    const result = toggleReaction([summary('🔥', 3, true)], '🔥', KINDS)
    expect(result).toEqual([summary('🔥', 2, false)])
  })

  it('убирает эмодзи целиком, если реакция была только своя', () => {
    expect(toggleReaction([summary('😂', 1, true)], '😂', KINDS)).toEqual([])
  })

  it('держит порядок как у сервера: популярные выше', () => {
    const result = toggleReaction([summary('👏', 1), summary('🔥', 2)], '👏', KINDS)
    // Счётчики сравнялись (2 и 2), а при равенстве порядок задаёт набор сервера —
    // поэтому первым остаётся 🔥, хотя своя реакция стоит на 👏.
    expect(result.map((item) => item.emoji)).toEqual(['🔥', '👏'])
    const second = toggleReaction(result, '❤️', KINDS)
    expect(second.map((item) => item.emoji)).toEqual(['🔥', '👏', '❤️'])
  })

  it('не трогает исходный массив (состояние стора неизменно до ответа)', () => {
    const original = [summary('🔥', 1, true)]
    toggleReaction(original, '🔥', KINDS)
    expect(original).toEqual([summary('🔥', 1, true)])
  })
})

describe('reactionTotal', () => {
  it('складывает все реакции, а не число эмодзи', () => {
    expect(reactionTotal([summary('❤️', 2), summary('🔥', 3)])).toBe(5)
    expect(reactionTotal([])).toBe(0)
  })
})

describe('quickReactions', () => {
  it('берёт первые N из набора сервера', () => {
    expect(quickReactions(KINDS, [], 2)).toEqual(['❤️', '🔥'])
  })

  it('добавляет эмодзи, которые уже стоят, даже вне быстрого ряда', () => {
    const result = quickReactions(KINDS, [summary('👍', 1, true)], 2)
    expect(result).toEqual(['❤️', '🔥', '👍'])
  })

  it('не дублирует эмодзи, если он уже в быстром ряду', () => {
    expect(quickReactions(KINDS, [summary('❤️', 1, true)], 2)).toEqual(['❤️', '🔥'])
  })
})

const author = (id: number, username = `u${id}`): StoryAuthor => ({
  id,
  username,
  first_name: null,
  last_name: null,
  avatar_url: null
})

/** Аудитория истории: по умолчанию «все просмотры влезли в список».
 *  Третий аргумент нужен, чтобы проверить случай «зрителей больше, чем имён». */
const audienceOf = (
  views: StoryAuthor[],
  reactions: { emoji: string; users: StoryAuthor[] }[],
  viewsTotal = views.length
): StoryAudience => ({ views, views_total: viewsTotal, reactions })

describe('audienceSections', () => {
  it('сначала реакции, просмотры — последней секцией', () => {
    const sections = audienceSections(
      audienceOf([author(1)], [{ emoji: '🔥', users: [author(2), author(3)] }])
    )
    expect(sections.map((section) => section.key)).toEqual(['reaction:🔥', 'views'])
    expect(sections[0].users).toHaveLength(2)
    expect(sections[1].emoji).toBeNull()
  })

  it('не показывает пустые секции', () => {
    const sections = audienceSections(
      audienceOf(
        [],
        [
          { emoji: '🔥', users: [] },
          { emoji: '❤️', users: [author(2)] }
        ]
      )
    )
    expect(sections.map((section) => section.key)).toEqual(['reaction:❤️'])
  })

  it('пустая аудитория — пустой список', () => {
    expect(audienceSections(audienceOf([], []))).toEqual([])
  })
})

describe('audienceViewsHint', () => {
  it('все просмотры влезли в список', () => {
    expect(audienceViewsHint(3, 3)).toBe('Всего: 3 просмотра')
  })

  it('склоняет число просмотров', () => {
    expect(audienceViewsHint(1, 1)).toBe('Всего: 1 просмотр')
    expect(audienceViewsHint(5, 5)).toBe('Всего: 5 просмотров')
    expect(audienceViewsHint(2, 2)).toBe('Всего: 2 просмотра')
  })

  it('честно говорит, что список неполный', () => {
    expect(audienceViewsHint(100, 250)).toBe('Всего: 250 просмотров · показаны последние 100')
  })

  it('без просмотров', () => {
    expect(audienceViewsHint(0, 0)).toBe('Всего: 0 просмотров')
  })
})

describe('зоны тапа', () => {
  it('левая и правая кромки листают историю', () => {
    expect(storyTapZone(0)).toBe('previous')
    expect(storyTapZone(0.31)).toBe('previous')
    expect(storyTapZone(0.69)).toBe('next')
    expect(storyTapZone(1)).toBe('next')
  })

  it('центр ставит быструю реакцию', () => {
    expect(storyTapZone(0.32)).toBe('reaction')
    expect(storyTapZone(0.5)).toBe('reaction')
    expect(storyTapZone(0.67)).toBe('reaction')
  })
})
