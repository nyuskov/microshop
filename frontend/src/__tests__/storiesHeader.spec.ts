import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StoryGroup, StoryItem } from '@/services/stories'
import {
  countVisibleCells,
  firstStoryToOpen,
  headerHiddenStoryGroups,
  headerStoriesLimit,
  headerStoryGroups,
  HEADER_STORIES_CLIP_TOLERANCE,
  HEADER_STORIES_LIMIT_WITH_NOTICE,
  HEADER_STORIES_MAX
} from '@/utils/stories'

/**
 * Истории в шапке списка чатов.
 *
 * Кружки, кнопки и подсказка в середине (состояние связи, тихие часы) делят одну
 * строку. Правило владельца: с подсказкой — не больше двух кружков («там и так
 * при подсказке максимум 2 истории»), без неё — сколько влезет ДО ПРАВЫХ ЗНАЧКОВ
 * (раньше стояло жёсткое «не больше 6», и оно не угадывало ширину экрана).
 * Раскладку jsdom не считает, поэтому правила проверяем как чистые функции, а
 * связку с разметкой — чтением исходников (как в `storiesHighlight.spec.ts`).
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

describe('сколько кружков в шапке', () => {
  const others = [
    group(1, [story(10)]),
    group(2, [story(20)]),
    group(3, [story(30)]),
    group(4, [story(40)]),
    group(5, [story(50)]),
    group(6, [story(60)]),
    group(7, [story(70)])
  ]

  it('с подсказкой в середине — два кружка, без неё — потолок разметки', () => {
    expect(headerStoriesLimit(true)).toBe(HEADER_STORIES_LIMIT_WITH_NOTICE)
    expect(HEADER_STORIES_LIMIT_WITH_NOTICE).toBe(2)
    // Без подсказки число не задано числом: сколько влезет, решает замер ширины,
    // а это только защита разметки от десятков групп.
    expect(headerStoriesLimit(false)).toBe(HEADER_STORIES_MAX)
    expect(HEADER_STORIES_MAX).toBe(16)
  })

  it('предел считается вместе с кружком «Моя история»', () => {
    // 2 всего = «моя» + 1 чужая: столько влезает рядом с подсказкой в середине.
    expect(headerStoryGroups(others, 2).map((item) => item.user.id)).toEqual([1])
    // Потолок — «моя» + 15 чужих (все, что есть).
    expect(headerStoryGroups(others, HEADER_STORIES_MAX)).toHaveLength(7)
    // Без ограничения (0) ряд не режем: так живёт раскрытая полоса.
    expect(headerStoryGroups(others, 0)).toHaveLength(7)
  })

  it('замер считает только целиком видимые кружки', () => {
    const box = { left: 0, right: 100 }
    expect(
      countVisibleCells(
        [
          { left: 0, right: 40 },
          { left: 12, right: 52 },
          { left: 60, right: 100 },
          // Хвост за краем коробки — это подсказка «есть ещё».
          { left: 90, right: 130 }
        ],
        box
      )
    ).toBe(3)
  })

  it('срез у края до допуска считается видимым', () => {
    // У полосы есть внутренние отступы 2 px, и крайний кружок всегда выступает за
    // коробку ровно на них: без допуска ряд с подсказкой схлопывался до одного
    // кружка вместо двух.
    const box = { left: 0, right: 100 }
    // Срез 2 px (внутренние отступы полосы) — кружок считаем видимым.
    expect(countVisibleCells([{ left: 62, right: 102 }], box)).toBe(1)
    // А срез больше допуска — уже «за краем»: не считаем.
    const tooFar = { left: 70, right: 100 + HEADER_STORIES_CLIP_TOLERANCE + 1 }
    expect(countVisibleCells([tooFar], box)).toBe(0)
  })

  it('счётчик «+N» показывает, сколько историй не влезло', () => {
    const few = [group(1, [story(10)]), group(2, [story(20)]), group(3, [story(30)])]

    // Видно 2 кружка в шапке = «моя» + 1 чужая → на счётчике остальные двое.
    expect(headerHiddenStoryGroups(few, 2)).toBe(2)
    // Влезли все четыре (три чужих + «моя») — считать нечего.
    expect(headerHiddenStoryGroups(few, 4)).toBe(0)
    // Места нет вовсе — скрыты все чужие (и счётчик не уходит в минус).
    expect(headerHiddenStoryGroups(few, 1)).toBe(3)
    expect(headerHiddenStoryGroups(few, 0)).toBe(3)
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

  it('шапка отдаёт полосе предел и берёт у неё число скрытых', () => {
    // Предел считает шапка (по подсказке в середине), а сколько влезло по ширине —
    // замер в самой полосе: она сообщает число скрытых назад (`hidden-count`).
    expect(header).toContain('headerStoriesLimit(noticeVisible.value)')
    expect(header).toContain(':limit="storiesLimit"')
    expect(header).toContain('@hidden-count="hiddenStories = $event"')
    // Своей копии правила в шапке быть не должно: иначе число разъедется.
    expect(header).not.toContain('headerHiddenStoryGroups')
  })

  it('сжатый ряд обрезается по пределу, а раскрытая полоса — нет', () => {
    expect(strip).toContain('props.limit > 0 ? props.limit : HEADER_STORIES_MAX')
    // Ряд рисуем ПО ПРЕДЕЛУ, а не по замеру: замер считается по нарисованным
    // кружкам, и связка «рисую по замеру — мерю нарисованное» залипала на одном
    // кружке (ГРАБЛЯ 29.09.2026: «+1, хотя место есть»).
    expect(strip).toContain('headerStoryGroups(stories.others, rowLimit.value)')
    expect(strip).not.toContain('headerStoryGroups(stories.others, capacity.value)')
    expect(strip).toContain('Math.min(rowLimit.value, visibleCells.value)')
    expect(strip).toContain('v-for="(group, index) in visibleOthers"')
  })

  it('замер пересчитывается и не залипает на нулевой коробке', () => {
    // Ноль ширины (закрытый ящик/скрытая панель) не должен объявлять скрытыми
    // все истории — иначе ряд залипает с «+N» и сам уже не вырастет.
    expect(strip).toContain('countVisibleCells(cells, box)')
    expect(strip).toContain('if (box.width <= 0) return')
  })

  it('о скрытых историях говорит счётчик «+N» рядом с полосой', () => {
    expect(strip).toContain('headerHiddenStoryGroups(stories.others, capacity.value)')
    // Счётчик — только сжатый ряд и только когда есть что считать.
    expect(strip).toContain('v-if="mini && hiddenOthers > 0"')
    expect(strip).toContain('+{{ hiddenOthers }}')
    // Нажатие по счётчику равносильно нажатию по кружку — раскрывает полосу.
    expect(strip).toContain('@click="emit(\'toggle-expand\')"')
  })

  it('кружки в шапке стоят плотнее (наложение 28 px)', () => {
    expect(strip).toContain('margin-left: -28px')
  })

  it('историю открывают по общему правилу — и кружок, и протяжка', () => {
    expect(strip).toContain('firstUnseenStoryId(group)')
    expect(sidebar).toContain('openStoriesPlayback')
    expect(sidebar).toContain('firstStoryToOpen(storiesStore.others, storiesStore.mine)')
  })
})
