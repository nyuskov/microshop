/**
 * Навигация по историям: плоский список и переходы «вперёд/назад».
 *
 * Вынесено из компонента просмотрщика, чтобы это можно было проверить тестами:
 * здесь вся арифметика границ (конец группы → следующая группа, конец ленты →
 * закрыть просмотрщик), а не разметка.
 */

import type {
  StoryAudience,
  StoryAuthor,
  StoryGroup,
  StoryItem,
  StoryReactionSummary
} from '@/services/stories'
import { parseServerTime } from '@/utils/format'
import { plural, t } from '@/i18n'

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

/**
 * Первая непросмотренная история автора (или первая, если всё просмотрено).
 *
 * Одно правило на все места, где историю открывают «с ходу»: кружок в шапке,
 * список авторов в разделе «Истории» и третья ступень протяжки списка чатов.
 */
export function firstUnseenStoryId(group: StoryGroup): number {
  const unseen = group.items.find((item) => !item.viewed)
  return (unseen ?? group.items[0]).id
}

/**
 * Что открывать при входе в истории без выбора автора: первая непросмотренная у
 * первого автора, а если чужих историй нет — своя. ``null`` — играть нечего.
 */
export function firstStoryToOpen(others: StoryGroup[], mine: StoryGroup | null): number | null {
  const group = others[0]
  if (group && group.items.length) return firstUnseenStoryId(group)
  return mine?.items[0]?.id ?? null
}

/**
 * Потолок кружков в сжатом ряду шапки, когда середина свободна.
 *
 * Прежнее правило «не больше 6» не угадывало ширину экрана: на телефоне ряд
 * обрезался, на широком — оставалось пустое место. Теперь ряд тянется до правых
 * значков, а сколько влезло, измеряет сам компонент (`countVisibleCells`). Здесь
 * только потолок для разметки: больше шестнадцати кружков не бывает даже на
 * планшете (16 × 12 px шага + 40 px кружка ≈ 220 px), но DOM не должен расти от
 * десятков групп.
 */
export const HEADER_STORIES_MAX = 16

/**
 * Предел кружков, когда середину шапки занимает подсказка (тихие часы, связь).
 *
 * Два — правило владельца (22.09.2026, подтверждено 26.09.2026: «там и так при
 * подсказке максимум 2 истории»): подсказка и ряд делят свободную середину
 * шапки, и на телефоне вдвоём не расходятся шире. Остальные истории никуда не
 * деваются: их показывает раскрытая полоса (там лимита нет) и счётчик «+N».
 */
export const HEADER_STORIES_LIMIT_WITH_NOTICE = 2

/**
 * Лимит кружков в шапке по подсказке в её середине.
 *
 * С подсказкой — жёсткие два кружка. Без неё — потолок разметки: ниже решает
 * замер, сколько кружков влезло до правых значков.
 */
export function headerStoriesLimit(noticeVisible: boolean): number {
  return noticeVisible ? HEADER_STORIES_LIMIT_WITH_NOTICE : HEADER_STORIES_MAX
}

/** Прямоугольник элемента — то, что нужно для замера (см. `countVisibleCells`). */
export interface RectLike {
  left: number
  right: number
}

/**
 * Сколько пикселей среза у крайнего кружка считаем незаметными.
 *
 * У полосы есть внутренние отступы (2 px), и крайний кружок всегда выступает за
 * коробку ровно на них: замер давал «виден один вместо двух», и ряд с подсказкой
 * схлопывался до одного кружка. Круг 34 px срезанные 3 px читаются целыми.
 */
export const HEADER_STORIES_CLIP_TOLERANCE = 3

/**
 * Сколько кружков ЦЕЛИКОМ видно в коробке полосы.
 *
 * Обрезанный у края кружок не считаем: он читается как «полоса продолжается», а
 * «+N» как раз называет то, что за краем. Допуск — `HEADER_STORIES_CLIP_TOLERANCE`.
 */
export function countVisibleCells(cells: readonly RectLike[], box: RectLike): number {
  const tol = HEADER_STORIES_CLIP_TOLERANCE
  return cells.filter((cell) => cell.left >= box.left - tol && cell.right <= box.right + tol).length
}

/**
 * Истории других людей, которые рисует СЖАТЫЙ ряд в шапке.
 *
 * ``limit`` — предел ряда (см. `headerStoriesLimit`), считается вместе с кружком
 * «Моя история» (он в ряду всегда первый), ``limit <= 0`` — без ограничения.
 * Сколько из нарисованных кружков ДОЙДЁТ до глаз, решает раскладка — это считает
 * `countVisibleCells`. Остальное не теряется: истории показывает раскрытая полоса
 * (там лимита нет) и счётчик «+N».
 */
export function headerStoryGroups(others: StoryGroup[], limit: number): StoryGroup[] {
  if (limit <= 0) return others
  return others.slice(0, Math.max(0, limit - 1))
}

/**
 * Сколько историй других НЕ влезло в сжатый ряд шапки.
 *
 * ``visibleCells`` — сколько кружков РЕАЛЬНО видно (считая «мою историю»: она в
 * ряду первая). Число приходит из замера (`countVisibleCells`), поэтому счётчик и
 * кружки не могут разъехаться: по двум кружкам иначе не понять, что за краем есть
 * ещё остальные (владелец: «чтобы понятно было, что их не две, а больше»).
 *
 * ``visibleCells <= 1`` — видна только «моя история»; счётчик остаётся нулём, а
 * не отрицательным числом.
 */
export function headerHiddenStoryGroups(others: StoryGroup[], visibleCells: number): number {
  const visibleOthers = Math.max(0, visibleCells - 1)
  return Math.max(0, others.length - visibleOthers)
}

/** «5 мин», «3 ч», «2 дн» — сколько живёт история (для подписи под аватаркой). */
export function formatStoryAge(createdAt: string, now: Date = new Date()): string {
  const created = parseServerTime(createdAt)
  if (Number.isNaN(created.getTime())) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - created.getTime()) / 1000))
  if (seconds < 60) return t('только что')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('{count} мин', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('{count} ч', { count: hours })
  return t('{count} дн', { count: Math.round(hours / 24) })
}

/** Идёт ли ещё видео/картинка (для прогресс-полоски истории). */
export function isVideoStory(mimeType: string | null): boolean {
  return Boolean(mimeType?.startsWith('video/'))
}

/* ---------------- Проверка видео перед публикацией ---------------- */

/** Сколько ждём первый кадр выбранного файла, прежде чем считать проверку неудачной. */
export const VIDEO_PROBE_TIMEOUT_MS = 6000

/** Чем закончилась проверка: играет, не играет или не дождались (неизвестно). */
export type VideoProbe = 'playable' | 'unsupported' | 'unknown'

/**
 * Пробует проиграть выбранный файл прямо в браузере.
 *
 * Зачем: телефон может записать видео в формате, который браузер не декодирует
 * вовсе (MPEG-4 Visual `mp4v` + звук AMR в 3GP-контейнере из старого аппарата —
 * Chromium отвечает «no supported streams»). Такое видео нельзя перекодировать
 * на клиенте: декодера для него у браузера нет. Поэтому мы всего лишь честно
 * сообщаем об этом и просим сервер перекодировать файл (см. `publish`).
 *
 * Ждём именно ПЕРВЫЙ КАДР (`loadeddata`), а не метаданные: метаданные Chromium
 * отдаёт и для файла, который затем отказывается декодировать.
 */
export function probeVideoPlayback(
  file: File,
  options: { timeoutMs?: number; createVideo?: () => HTMLVideoElement } = {}
): Promise<VideoProbe> {
  const createVideo =
    options.createVideo ?? ((): HTMLVideoElement => document.createElement('video'))
  const timeoutMs = options.timeoutMs ?? VIDEO_PROBE_TIMEOUT_MS
  return new Promise((resolve) => {
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : ''
    const element = createVideo()
    let settled = false
    const finish = (result: VideoProbe) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      element.removeEventListener('loadeddata', onLoaded)
      element.removeEventListener('error', onError)
      element.removeAttribute('src')
      if (url) URL.revokeObjectURL(url)
      resolve(result)
    }
    const onLoaded = () => finish('playable')
    const onError = () => finish('unsupported')
    element.addEventListener('loadeddata', onLoaded)
    element.addEventListener('error', onError)
    element.preload = 'auto'
    // Звук не нужен: проверяем только то, декодируется ли картинка.
    element.muted = true
    element.src = url
    const timer = window.setTimeout(() => finish('unknown'), timeoutMs)
  })
}

/* ---------------- Реакции ---------------- */

/** Порядок как на сервере: сначала популярные, при равенстве — порядок набора. */
function sortReactions(
  reactions: StoryReactionSummary[],
  kinds: string[] = []
): StoryReactionSummary[] {
  const order = new Map(kinds.map((emoji, index) => [emoji, index]))
  return [...reactions].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return (order.get(a.emoji) ?? kinds.length) - (order.get(b.emoji) ?? kinds.length)
  })
}

/**
 * Локальное переключение реакции — то же, что делает сервер, но без запроса.
 *
 * Нужно, чтобы панель отвечала мгновенно (запрос в это время летит), а при
 * ошибке состояние откатывается к прежнему. Логика повторяет серверную:
 * нет реакции — появляется, своя уже стоит — снимается, есть чужая — своя
 * добавляется к ней.
 */
export function toggleReaction(
  reactions: StoryReactionSummary[],
  emoji: string,
  kinds: string[] = []
): StoryReactionSummary[] {
  const existing = reactions.find((item) => item.emoji === emoji)

  if (!existing) {
    return sortReactions([...reactions, { emoji, count: 1, mine: true }], kinds)
  }
  if (existing.mine) {
    return sortReactions(
      reactions
        .map((item) =>
          item.emoji === emoji ? { ...item, count: item.count - 1, mine: false } : item
        )
        .filter((item) => item.count > 0),
      kinds
    )
  }
  return sortReactions(
    reactions.map((item) =>
      item.emoji === emoji ? { ...item, count: item.count + 1, mine: true } : item
    ),
    kinds
  )
}

/** Сколько всего реакций на истории — для подписи «N реакций». */
export function reactionTotal(reactions: StoryReactionSummary[]): number {
  return reactions.reduce((sum, item) => sum + item.count, 0)
}

/**
 * Эмодзи для «быстрого» ряда: сначала набор сервера, но обязательно с теми, что
 * уже стоят на этой истории (иначе свою реакцию нельзя было бы снять тапом).
 */
export function quickReactions(
  kinds: string[],
  reactions: StoryReactionSummary[],
  primary: number
): string[] {
  const used = reactions.map((item) => item.emoji)
  const result = kinds.slice(0, Math.max(1, primary)).filter((emoji) => kinds.includes(emoji))
  for (const emoji of used) {
    if (!result.includes(emoji)) result.push(emoji)
  }
  return result
}

/** Куда ведёт тап по сцене просмотрщика. */
export type StoryTapZone = 'previous' | 'reaction' | 'next'

/** Доля ширины сцены, отданная зонам «назад» и «вперёд» (как в разметке зон). */
const TAP_ZONE_EDGE_RATIO = 0.32

/**
 * Зона тапа: левый и правый края листают, центр ставит быструю реакцию.
 *
 * Края заняты стрелками листания (они видны на экране), поэтому мгновенная
 * реакция живёт в центре — один тап делает одно действие, а листать можно ещё
 * и свайпом.
 */
export function storyTapZone(ratio: number): StoryTapZone {
  if (ratio < TAP_ZONE_EDGE_RATIO) return 'previous'
  if (ratio > 1 - TAP_ZONE_EDGE_RATIO) return 'next'
  return 'reaction'
}

/** Что делает отпущенный палец в просмотрщике историй. */
export type StorySwipeResult = 'close' | 'next' | 'previous' | 'none'

/** Порог выхода из истории: сдвиг по вертикали в любую сторону. */
export const STORY_SWIPE_CLOSE_DISTANCE = 90

/** Порог перелистывания вбок: соседняя история автора. */
export const STORY_SWIPE_STEP_DISTANCE = 55

/**
 * Итог жеста в просмотрщике: вверх и вниз — выйти из истории, вбок — соседняя.
 *
 * ВВЕРХ закрываем так же, как вниз (владелец, 29.09.2026: «жестом вверх в
 * мобилке нужно, чтобы я мог уже открытую историю свернуть и выйти из неё»):
 * движение вверх — привычный «свернуть» на телефоне, и он не должен требовать
 * попадания пальцем по крестику. Раньше жест вверх уводил историю за край
 * экрана и возвращал её назад: экран уезжал, а человек оставался в просмотре.
 *
 * Мелкое смещение жестом не считаем: обычный тап с дрожанием пальца обязан
 * остаться тапом (листание/реакция), иначе история закрывалась бы сама.
 */
export function storySwipeResult(dx: number, dy: number): StorySwipeResult {
  if (dy > STORY_SWIPE_CLOSE_DISTANCE || dy < -STORY_SWIPE_CLOSE_DISTANCE) return 'close'
  if (dx < -STORY_SWIPE_STEP_DISTANCE) return 'next'
  if (dx > STORY_SWIPE_STEP_DISTANCE) return 'previous'
  return 'none'
}

/* ---------------- Аудитория своей истории ---------------- */

/** Секция списка в панели аудитории: эмодзи (или просмотры) и люди. */
export interface StoryAudienceSection {
  key: string
  /** `null` — секция просмотров (без эмодзи). */
  emoji: string | null
  users: StoryAuthor[]
}

/**
 * Секции панели «кто смотрел»: сначала реакции по эмодзи, последней — просмотры.
 *
 * Пустые секции не отдаём: панель не должна показывать заголовок без людей.
 */
export function audienceSections(audience: StoryAudience): StoryAudienceSection[] {
  const sections: StoryAudienceSection[] = audience.reactions
    .filter((group) => group.users.length > 0)
    .map((group) => ({ key: `reaction:${group.emoji}`, emoji: group.emoji, users: group.users }))

  if (audience.views.length > 0) {
    sections.push({ key: 'views', emoji: null, users: audience.views })
  }
  return sections
}

/**
 * Подпись под списком просмотревших.
 *
 * Всех показываем, если влезли; если зрителей больше, чем имён в ответе, честно
 * пишем, что список неполный — иначе автор решит, что смотрели только эти люди.
 */
export function audienceViewsHint(shown: number, total: number): string {
  const label = `${total} ${plural(total, ['просмотр', 'просмотра', 'просмотров'], ['view', 'views'])}`
  if (total <= shown) return t('Всего: {label}', { label })
  return t('Всего: {label} · показаны последние {shown}', { label, shown })
}
