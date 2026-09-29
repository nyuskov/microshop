import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  STORY_SWIPE_CLOSE_DISTANCE,
  STORY_SWIPE_STEP_DISTANCE,
  storySwipeResult
} from '@/utils/stories'

/**
 * Жест в полноэкранном просмотре истории.
 *
 * Владелец (29.09.2026): «жестом вверх в мобилке нужно, чтобы я мог уже открытую
 * историю свернуть и выйти из неё». Раньше вверх только уводило историю за край
 * экрана и возвращало назад — экран уезжал, а человек оставался в просмотре.
 *
 * Разбор жеста — чистая функция `storySwipeResult`, её и проверяем; отдельно
 * следим, что просмотрщик зовёт именно её (своих порогов у него быть не должно:
 * разъедутся с тестами и с жестом вниз).
 */

const viewer = readFileSync('src/components/stories/StoryViewer.vue', 'utf8')

describe('разбор жеста в просмотрщике историй', () => {
  it('движение вверх выходит из истории', () => {
    expect(storySwipeResult(0, -STORY_SWIPE_CLOSE_DISTANCE - 1)).toBe('close')
    expect(storySwipeResult(0, -400)).toBe('close')
  })

  it('движение вниз, как и раньше, выходит из истории', () => {
    expect(storySwipeResult(0, STORY_SWIPE_CLOSE_DISTANCE + 1)).toBe('close')
    expect(storySwipeResult(0, 300)).toBe('close')
  })

  it('движение вбок листает на соседнюю историю автора', () => {
    expect(storySwipeResult(-STORY_SWIPE_STEP_DISTANCE - 1, 0)).toBe('next')
    expect(storySwipeResult(STORY_SWIPE_STEP_DISTANCE + 1, 0)).toBe('previous')
  })

  it('мелкое смещение жестом не считается', () => {
    // Обычный тап с дрожанием пальца: листаем/ставим реакцию, НЕ закрываем.
    expect(storySwipeResult(0, -10)).toBe('none')
    expect(storySwipeResult(4, 6)).toBe('none')
    // Ровно на пороге — ещё не жест: закрывать на грани дребезга нельзя.
    expect(storySwipeResult(0, -STORY_SWIPE_CLOSE_DISTANCE)).toBe('none')
    expect(storySwipeResult(0, STORY_SWIPE_CLOSE_DISTANCE)).toBe('none')
    expect(storySwipeResult(-STORY_SWIPE_STEP_DISTANCE, 0)).toBe('none')
  })

  it('диагональный жест уводит из истории, а не листает', () => {
    // Вбок ушло больше порога, но вверх — дальше: на телефоне это «свернуть».
    expect(storySwipeResult(60, -150)).toBe('close')
  })
})

describe('просмотрщик использует общий разбор жеста', () => {
  it('отпускание пальца разбирает `storySwipeResult`, а не свои пороги', () => {
    const handler = viewer.slice(viewer.indexOf('const onPointerUp'))
    expect(handler).toContain('storySwipeResult(dragX.value, dragY.value)')
    // Пороги живут в утилите: локальные константы когда-то разъедутся с тестами.
    expect(viewer).not.toContain('SWIPE_CLOSE_DISTANCE = 90')
    expect(viewer).not.toContain('SWIPE_STEP_DISTANCE = 55')
  })

  it('выход проверяется раньше листания', () => {
    const handler = viewer.slice(viewer.indexOf('const onPointerUp'))
    const closeAt = handler.indexOf("if (result === 'close')")
    const nextAt = handler.indexOf("if (result === 'next')")
    expect(closeAt).toBeGreaterThan(-1)
    expect(nextAt).toBeGreaterThan(closeAt)
    // Выход не продолжается листанием: сразу return.
    expect(handler.slice(closeAt, nextAt)).toContain('return')
  })

  it('недостаточный жест плавно возвращает историю на место', () => {
    expect(viewer).toMatch(/\.story-viewer \{[\s\S]{0,400}transition:[\s\S]{0,80}transform/)
    // Во время самого перетаскивания переход выключен — иначе палец «тянет» с
    // задержкой.
    expect(viewer).toContain("transition: 'none'")
  })
})
