import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Стражи «быстрой реакции» на историю и уведомления автору.
 *
 * Жест тапа и подсказка автору живут в разметке, service worker и обработчике
 * сокета — их не поймать юнит-тестом чистой функции, а сломать легко: достаточно
 * вернуть реакцию на двойной тап (человеку он неочевиден) или потерять ветку
 * события в синхронизации.
 *
 * Поэтому читаем исходники и проверяем связки: тап → реакция, событие сокета →
 * обновление ленты, push → открытие истории.
 */

const viewer = readFileSync('src/components/stories/StoryViewer.vue', 'utf8')
const realtimeStore = readFileSync('src/stores/realtime.ts', 'utf8')
const realtimeSync = readFileSync('src/composables/useRealtimeSync.ts', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
const serviceWorker = readFileSync('public/sw.js', 'utf8')

describe('быстрая реакция по тапу', () => {
  it('тап по сцене обрабатывается нашим жестом, а не кликом зон', () => {
    expect(viewer).toContain('@pointerup="onStageTap"')
    expect(viewer).toContain("onZoneClick($event, 'left')")
    expect(viewer).toContain("onZoneClick($event, 'right')")
    // Клик зон нужен только клавиатуре: мышь и палец разбирает onStageTap.
    expect(viewer).toContain('if (event.detail !== 0) return')
  })

  it('действие зависит от зоны: края листают, центр ставит реакцию', () => {
    const handler = viewer.slice(viewer.indexOf('const onStageTap'))
    expect(handler).toContain('storyTapZone(ratio)')
    expect(handler).toContain("if (zone === 'previous') previous()")
    expect(handler).toContain("else if (zone === 'next') next()")
    expect(handler).toContain('else quickReact(')
    // Жест ровно один — двойного тапа и задержки листания быть не должно.
    expect(viewer).not.toContain('isDoubleTap')
    expect(viewer).not.toContain('TAP_DELAY_MS')
    expect(viewer).not.toContain('pendingTap')
  })

  it('реакция ставится на сервер и рисует вспышку', () => {
    const react = viewer.slice(viewer.indexOf('const quickReact'))
    expect(react).toContain('spawnBurst(quickEmoji.value, x, y)')
    expect(react).toContain('stories.react(entry.story.id, quickEmoji.value)')
    // На своей истории реакции не бывает — сервер отвечает 400.
    expect(react).toContain('entry.isMine')
    // Вспышка — свой слой в разметке и анимация в стилях.
    expect(viewer).toContain('class="reaction-burst"')
    expect(viewer).toContain('@keyframes story-burst')
    expect(viewer).toContain('bursts.value = []')
  })

  it('жесты-свайпы и удержание не считаются тапом', () => {
    const handler = viewer.slice(viewer.indexOf('const onStageTap'))
    expect(handler).toContain(
      "if (gestureAxis !== 'none' || dragX.value !== 0 || dragY.value !== 0) return"
    )
  })
})

describe('уведомление автору о реакции', () => {
  it('событие сокета объявлено в типах и разбирается синхронизацией', () => {
    expect(realtimeStore).toContain("type: 'story.reaction'")
    expect(realtimeSync).toContain("case 'story.reaction'")
    expect(realtimeSync).toContain('options.onStoryReaction?.(event)')
  })

  it('приложение обновляет ленту историй и озвучивает реакцию', () => {
    expect(messenger).toContain('onStoryReaction: handleStoryReaction')
    const handler = messenger.slice(messenger.indexOf('const handleStoryReaction'))
    expect(handler).toContain('storiesStore.load()')
    expect(handler).toContain('announceLiveMessage(')
  })

  it('push открывает приложение на своей истории', () => {
    expect(serviceWorker).toContain("data.type === 'story_reaction'")
    expect(serviceWorker).toContain("type: 'open-story'")
    expect(serviceWorker).toContain("'/?story='")
    // Тег от сервера: уведомления об одной истории заменяют друг друга.
    expect(serviceWorker).toContain('payload.tag ||')
    expect(messenger).toContain("data.type === 'open-story'")
    expect(messenger).toContain("launchParams.get('story')")
  })
})
