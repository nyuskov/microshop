import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StoryGroup, StoryItem } from '@/services/stories'
import {
  firstStoryToOpen,
  headerStoriesLimit,
  headerStoryGroups,
  HEADER_STORIES_LIMIT,
  HEADER_STORIES_LIMIT_WITH_NOTICE
} from '@/utils/stories'

/**
 * Истории в шапке списка чатов.
 *
 * Кружки историй, кнопки и надпись о связи (состояние связи, тихие часы) делят
 * одну строку, поэтому число кружков зависит от того, занята ли середина
 * (владелец: «с надписью в центре — 3, без неё — 6»). Раскладку jsdom не
 * считает, поэтому сами правила проверяем как чистые функции, а связку с
 * разметкой — чтением исходников (как в `storiesHighlight.spec.ts`).
 */

const story = (id: number, viewed = false): StoryItem => ({
  id,
  media_url: `/media/${id}.jpg`,
  media_name: `${id}.jpg`,
  mime_type: 'image/jpeg',
  caption: null,
  created_at: '2026-09-22T10:00:00Z',
  expires_at: '2026-09-23T10:00:00Z',
  viewed,
  views: 0,
  reactions: []
})

const group = (userId: number, items: StoryItem[], isMine = false): StoryGroup => ({
  user: {
    id: userId,
    username: `u${userId}`,
    first_name: null,
    last_name: null,
    avatar_url: null
  },
  items,
  has_unseen: items.some((item) => !item.viewed),
  is_mine: isMine
})

/** Исходники без переводов строк: prettier волен переносить вызовы по-разному. */
const flat = (source: string): string => source.replace(/\s+/g, ' ')

describe('лимит кружков в шапке', () => {
  it('в шапке не больше двух кружков — и с надписью, и без неё', () => {
    expect(headerStoriesLimit(true)).toBe(HEADER_STORIES_LIMIT_WITH_NOTICE)
    expect(headerStoriesLimit(false)).toBe(HEADER_STORIES_LIMIT)
    expect(HEADER_STORIES_LIMIT_WITH_NOTICE).toBe(2)
    expect(HEADER_STORIES_LIMIT).toBe(2)
  })

  it('лимит считается вместе с кружком «Моя история»', () => {
    const others = [group(1, [story(10)]), group(2, [story(20)]), group(3, [story(30)])]

    // 2 всего = «моя» + 1 чужая: больше в шапке не показываем.
    expect(headerStoryGroups(others, 2).map((item) => item.user.id)).toEqual([1])
    // Без ограничения (0) ряд не режем: так живёт раскрытая полоса.
    expect(headerStoryGroups(others, 0)).toHaveLength(3)
  })
})

describe('что открывает воспроизведение историй', () => {
  it('берёт первую непросмотренную у первого автора', () => {
    const others = [group(1, [story(10, true), story(11)]), group(2, [story(20)])]

    expect(firstStoryToOpen(others, null)).toBe(11)
  })

  it('если чужих историй нет — открывает свою', () => {
    const mine = group(9, [story(90)], true)

    expect(firstStoryToOpen([], mine)).toBe(90)
  })

  it('играть нечего — отдаёт null (жест ничего не открывает)', () => {
    expect(firstStoryToOpen([], null)).toBeNull()
  })
})

describe('связка с разметкой', () => {
  const header = flat(readFileSync('src/components/messenger/SidebarHeader.vue', 'utf8'))
  const strip = flat(readFileSync('src/components/stories/StoriesStrip.vue', 'utf8'))
  const sidebar = flat(readFileSync('src/components/messenger/ChatSidebar.vue', 'utf8'))

  it('шапка считает лимит по надписи в середине и отдаёт его кружкам', () => {
    // Правило одно на двоих: по нему же решает, что показывать, сама надпись.
    expect(header).toContain('useConnectionNotice')
    expect(header).toContain('headerStoriesLimit(noticeVisible.value)')
    expect(header).toContain(':limit="storiesLimit"')
  })

  it('сжатый ряд обрезается по лимиту, а раскрытая полоса — нет', () => {
    expect(strip).toContain('props.mini ? headerStoryGroups(stories.others, props.limit)')
    expect(strip).toContain('v-for="(group, index) in visibleOthers"')
  })

  it('кружки в шапке стоят плотнее (наложение 24 px)', () => {
    expect(strip).toContain('margin-left: -24px')
  })

  it('историю открывают по общему правилу — и кружок, и протяжка', () => {
    expect(strip).toContain('firstUnseenStoryId(group)')
    expect(sidebar).toContain('openStoriesPlayback')
    expect(sidebar).toContain('firstStoryToOpen(storiesStore.others, storiesStore.mine)')
  })
})
