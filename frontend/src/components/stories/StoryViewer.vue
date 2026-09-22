<template>
  <div
    v-if="current"
    ref="trapContainer"
    class="story-viewer"
    :style="viewerStyle"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    @click.self="emit('close')"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <!-- Автор и управление -->
    <header class="viewer-head">
      <span class="viewer-avatar" :style="avatarStyle(authorName)">
        <img v-if="authorAvatar" :src="authorAvatar" alt="" decoding="async" />
        <template v-else>{{ authorInitials }}</template>
      </span>
      <span class="viewer-text">
        <span class="viewer-name">{{ current.isMine ? 'Моя история' : authorName }}</span>
        <span class="viewer-age">{{ age }}</span>
      </span>
      <button
        v-if="current.isMine"
        class="viewer-icon"
        type="button"
        :title="t('Кто смотрел')"
        @click.stop="openAudience()"
      >
        <q-icon :name="icon('visibility')" size="22px" />
      </button>
      <button
        v-if="current.isMine"
        class="viewer-icon"
        type="button"
        :title="t('Удалить историю')"
        @click.stop="removeCurrent"
      >
        <q-icon :name="icon('delete_outline')" size="22px" />
      </button>
      <button class="viewer-icon" type="button" :title="t('Закрыть')" @click.stop="emit('close')">
        <q-icon :name="icon('close')" size="24px" />
      </button>
    </header>

    <!-- Полоски прогресса: по одной на историю автора -->
    <div class="viewer-bars">
      <span
        v-for="(item, index) in currentGroupItems"
        :key="item.id"
        class="viewer-bar"
        :class="{ done: index < current.itemIndex }"
      >
        <span class="viewer-bar-fill" :style="{ width: barWidth(index) }"></span>
      </span>
    </div>

    <!-- Медиа истории -->
    <div class="viewer-stage" @pointerup="onStageTap">
      <img
        v-if="!isVideo"
        :src="mediaUrl(current.story.media_url)"
        class="viewer-media"
        alt=""
        decoding="async"
        @load="startTimer"
      />
      <video
        v-else
        ref="videoEl"
        class="viewer-media"
        :src="mediaUrl(current.story.media_url)"
        autoplay
        playsinline
        @ended="next"
        @timeupdate="onVideoProgress"
        @error="onVideoError"
      ></video>

      <!-- Видео не проигралось: вместо чёрного экрана объясняем и продолжаем
           показ. Так бывает, если файл записан в формате, который браузер не
           декодирует (см. core/video_transcode.py на сервере). -->
      <div v-if="videoFailed" class="viewer-failed" role="status">
        <q-icon :name="icon('warning')" size="30px" aria-hidden="true" />
        <p class="viewer-failed-text">
          {{
            t(
              'Это видео не проигрывается в этом браузере — файл записан в формате, который он не умеет читать. Дальше показ продолжится.'
            )
          }}
        </p>
        <a
          class="viewer-failed-link"
          :href="mediaUrl(current.story.media_url)"
          target="_blank"
          rel="noopener"
        >
          Открыть файл
        </a>
      </div>

      <!-- Вспышки быстрых реакций: «сердечко» вылетает из точки тапа по центру. -->
      <span
        v-for="burst in bursts"
        :key="burst.id"
        class="reaction-burst"
        :style="{ left: `${burst.x}px`, top: `${burst.y}px` }"
        aria-hidden="true"
        >{{ burst.emoji }}</span
      >

      <!-- Зоны «назад/вперёд» -->
      <button
        class="viewer-zone left"
        type="button"
        :title="t('Предыдущая')"
        @click.stop="onZoneClick($event, 'left')"
      >
        <q-icon :name="icon('chevron_left')" size="30px" />
      </button>
      <button
        class="viewer-zone right"
        type="button"
        :title="t('Следующая')"
        @click.stop="onZoneClick($event, 'right')"
      >
        <q-icon :name="icon('chevron_right')" size="30px" />
      </button>
    </div>

    <footer class="viewer-foot">
      <!-- Реакции. На своей истории они только читаются (счётчики), на чужой —
           можно ставить: тап по эмодзи, повторный тап снимает. -->
      <div v-if="current.isMine" class="viewer-reactions is-own" @pointerdown.stop>
        <template v-if="storyReactions.length">
          <button
            v-for="item in storyReactions"
            :key="item.emoji"
            class="reaction-chip"
            type="button"
            :title="t('Кто отреагировал')"
            @click.stop="openAudience()"
          >
            <span class="reaction-emoji">{{ item.emoji }}</span>
            <span class="reaction-count">{{ item.count }}</span>
          </button>
        </template>
        <span v-else class="viewer-reactions-hint">{{ t('Реакций пока нет') }}</span>
      </div>
      <div v-else class="viewer-reactions" :class="{ expanded }" @pointerdown.stop>
        <button
          v-for="emoji in visibleKinds"
          :key="emoji"
          class="reaction-btn"
          :class="{ mine: isMineReaction(emoji), used: countOf(emoji) > 0 }"
          type="button"
          :title="reactionTitle(emoji)"
          :aria-pressed="isMineReaction(emoji)"
          @click.stop="onReact(emoji)"
        >
          <span class="reaction-emoji">{{ emoji }}</span>
          <span v-if="countOf(emoji)" class="reaction-count">{{ countOf(emoji) }}</span>
        </button>
        <button
          v-if="stories.reactionKinds.length > visibleKinds.length || expanded"
          class="reaction-btn more"
          type="button"
          :title="expanded ? 'Свернуть реакции' : 'Ещё реакции'"
          :aria-expanded="expanded"
          @click.stop="expanded = !expanded"
        >
          <q-icon :name="icon(expanded ? 'close' : 'add_reaction')" size="18px" />
        </button>
      </div>

      <p v-if="current.story.caption" class="viewer-caption">{{ current.story.caption }}</p>

      <!-- Ответ текстом: уходит автору сообщением в личный чат (как в Instagram).
           На своей истории поля нет — себе не отвечают. -->
      <form
        v-if="!current.isMine"
        class="viewer-reply"
        @submit.prevent="sendReply"
        @pointerdown.stop
      >
        <input
          v-model="replyText"
          class="viewer-reply-input"
          type="text"
          maxlength="500"
          :placeholder="`Ответить ${authorName}…`"
          :aria-label="t('Ответить на историю')"
          @keydown.stop
        />
        <button
          class="viewer-reply-btn"
          type="submit"
          :title="t('Отправить ответ')"
          :disabled="!replyText.trim()"
        >
          <q-icon :name="icon('send')" size="20px" />
        </button>
      </form>
      <p v-if="current.isMine" class="viewer-views">
        <button class="viewer-views-btn" type="button" @click.stop="openAudience()">
          <q-icon :name="icon('visibility')" size="14px" /> {{ current.story.views }}
          <span class="viewer-views-label">{{ t('кто смотрел') }}</span>
        </button>
      </p>
    </footer>

    <!-- Аудитория своей истории: кто смотрел и кто как отреагировал -->
    <div
      v-if="audienceOpen"
      class="audience-backdrop"
      @click.self="closeAudience"
      @pointerdown.stop
      @pointerup.stop
    >
      <section
        class="audience-sheet"
        role="dialog"
        aria-modal="true"
        :aria-label="t('Аудитория истории')"
      >
        <header class="audience-head">
          <span class="audience-title">{{ t('Аудитория истории') }}</span>
          <button
            class="viewer-icon"
            type="button"
            :title="t('Закрыть')"
            @click.stop="closeAudience"
          >
            <q-icon :name="icon('close')" size="22px" />
          </button>
        </header>

        <p v-if="audienceLoading" class="audience-status">{{ t('Загрузка…') }}</p>
        <p v-else-if="audienceError" class="audience-status error">{{ audienceError }}</p>
        <template v-else-if="audience">
          <p class="audience-hint">{{ viewsHint }}</p>
          <p v-if="!audienceSections.length" class="audience-status">
            {{ t('Пока никто не смотрел') }}
          </p>
          <div v-for="section in audienceSections" :key="section.key" class="audience-group">
            <span class="audience-badge">
              <template v-if="section.emoji">{{ section.emoji }}</template>
              <q-icon v-else :name="icon('visibility')" size="15px" />
              <span class="audience-count">{{ section.users.length }}</span>
            </span>
            <ul class="audience-list">
              <li v-for="user in section.users" :key="user.id" class="audience-user">
                <span
                  class="audience-avatar"
                  :style="avatarStyle(displayName(user) || user.username)"
                >
                  <img
                    v-if="avatarOf(user)"
                    :src="avatarOf(user)"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <template v-else>{{ initials(displayName(user) || user.username) }}</template>
                </span>
                <span class="audience-name">{{ displayName(user) || `@${user.username}` }}</span>
              </li>
            </ul>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { mediaUrl } from '@/config'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { getErrorMessage } from '@/services/errors'
import {
  fetchStoryAudience,
  type StoryAudience,
  type StoryAuthor,
  type StoryGroup
} from '@/services/stories'
import { useStoriesStore } from '@/stores/stories'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { t } from '@/i18n'
import {
  audienceSections as buildAudienceSections,
  audienceViewsHint,
  flattenStories,
  formatStoryAge,
  isVideoStory,
  nextStory,
  previousStory,
  quickReactions,
  storyTapZone,
  type FlatStory
} from '@/utils/stories'

const props = defineProps<{
  groups: StoryGroup[]
  startStoryId: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** Ответ на историю текстом: родитель отправляет его автору в личный чат. */
  (e: 'reply', payload: { storyId: number; authorId: number; text: string }): void
}>()

/**: Сколько показывать картинку, если это не видео. */
const IMAGE_DURATION_MS = 5000

/** Сколько держим плашку «видео не проигрывается», прежде чем листнуть дальше. */
const VIDEO_FAIL_DURATION_MS = 6000

const stories = useStoriesStore()
const videoEl = ref<HTMLVideoElement | null>(null)
const currentId = ref(props.startStoryId)

// Полноэкранный просмотрщик — свой оверлей: Tab не должен уходить в чат под ним.
const { container: trapContainer } = useFocusTrap(() => currentId.value > 0)
const progress = ref(0)
/** Пауза по удержанию: как в мессенджерах — держишь палец, история стоит. */
const paused = ref(false)
/** Сдвиги при перетаскивании: вниз — закрыть, вбок — соседняя история. */
const dragY = ref(0)
const dragX = ref(0)
let gestureStartX = 0
let gestureStartY = 0
let gestureAxis: 'none' | 'x' | 'y' = 'none'

/** Порог срабатывания жестов. */
const SWIPE_CLOSE_DISTANCE = 90
const SWIPE_STEP_DISTANCE = 55
let timer: ReturnType<typeof setTimeout> | undefined
let raf: number | undefined
let startedAt = 0

const flat = computed<FlatStory[]>(() => flattenStories(props.groups))
const current = computed<FlatStory | null>(
  () => flat.value.find((entry) => entry.story.id === currentId.value) ?? null
)

const currentGroupItems = computed(() => {
  const entry = current.value
  if (!entry) return []
  return props.groups.find((group) => group.user.id === entry.author.id)?.items ?? []
})

const isVideo = computed(() => isVideoStory(current.value?.story.mime_type ?? null))

const authorName = computed(() => {
  const author = current.value?.author
  return author ? displayName(author) || `@${author.username}` : ''
})

const authorAvatar = computed(() => {
  const author = current.value?.author
  return author ? avatarOf(author) : ''
})

const authorInitials = computed(() => initials(authorName.value || 'П'))

const age = computed(() => formatStoryAge(current.value?.story.created_at ?? ''))

/** Сбой видео: файл в формате, который браузер не декодирует (или битый). */
const videoFailed = ref(false)

/** Ширина полоски: пройденные — целиком, текущая — по прогрессу показа. */
const barWidth = (index: number): string => {
  const entry = current.value
  if (!entry) return '0%'
  if (index < entry.itemIndex) return '100%'
  if (index > entry.itemIndex) return '0%'
  return `${Math.min(100, Math.round(progress.value * 100))}%`
}

const stopTimer = () => {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = undefined
  if (raf !== undefined) window.cancelAnimationFrame(raf)
  raf = undefined
}

/** Для картинок прогресс рисуем сами: таймер + кадры анимации. */
const startTimer = () => {
  stopTimer()
  if (isVideo.value) {
    void videoEl.value?.play().catch(() => undefined)
    return
  }
  startImageTimer(IMAGE_DURATION_MS)
}

/**
 * Показ «как картинку»: таймер заканчивается — листаем дальше.
 *
 * Так же показываем и не проигравшееся видео (`onVideoError`): событие `ended`
 * от него не придёт, и без этого лента застряла бы на этой истории навсегда.
 */
const startImageTimer = (durationMs: number) => {
  stopTimer()
  startedAt = Date.now()
  const tick = () => {
    if (paused.value) {
      // Держим точку отсчёта на месте, пока палец на экране.
      startedAt += 16
      raf = window.requestAnimationFrame(tick)
      return
    }
    const elapsed = Date.now() - startedAt
    progress.value = Math.min(1, elapsed / durationMs)
    if (elapsed >= durationMs) {
      next()
      return
    }
    raf = window.requestAnimationFrame(tick)
  }
  raf = window.requestAnimationFrame(tick)
}

/** Видео не декодировалось: говорим об этом прямо и всё равно листаем дальше. */
const onVideoError = () => {
  videoFailed.value = true
  startImageTimer(VIDEO_FAIL_DURATION_MS)
}

/* ---------------- Жесты ---------------- */

const viewerStyle = computed<Record<string, string> | undefined>(() => {
  if (!dragY.value && !dragX.value) return undefined
  const style: Record<string, string> = { transition: 'none' }
  if (dragY.value) {
    style.transform = `translateY(${dragY.value}px)`
    style.opacity = String(Math.max(0.4, 1 - Math.abs(dragY.value) / 400))
  }
  if (dragX.value) style.transform = `translateX(${dragX.value / 3}px)`
  return style
})

const pauseForHold = () => {
  paused.value = true
  const el = videoEl.value
  if (el && !el.paused) el.pause()
}

const resumeAfterHold = () => {
  paused.value = false
  const el = videoEl.value
  if (el && el.paused) void el.play().catch(() => undefined)
}

const onPointerDown = (event: PointerEvent) => {
  gestureStartX = event.clientX
  gestureStartY = event.clientY
  gestureAxis = 'none'
  dragY.value = 0
  dragX.value = 0
  pauseForHold()
}

const onPointerMove = (event: PointerEvent) => {
  if (gestureStartX === 0 && gestureStartY === 0) return
  const dx = event.clientX - gestureStartX
  const dy = event.clientY - gestureStartY
  if (gestureAxis === 'none') {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
    gestureAxis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x'
  }
  if (gestureAxis === 'y') dragY.value = dy
  else dragX.value = dx
}

const onPointerUp = () => {
  const dy = dragY.value
  const dx = dragX.value
  gestureStartX = 0
  gestureStartY = 0
  gestureAxis = 'none'
  dragY.value = 0
  dragX.value = 0
  resumeAfterHold()
  if (dy > SWIPE_CLOSE_DISTANCE) {
    emit('close')
    return
  }
  if (dx < -SWIPE_STEP_DISTANCE) next()
  else if (dx > SWIPE_STEP_DISTANCE) previous()
}

const onPointerCancel = () => {
  gestureStartX = 0
  gestureStartY = 0
  gestureAxis = 'none'
  dragY.value = 0
  dragX.value = 0
  resumeAfterHold()
}

/* ---------------- Быстрая реакция (тап по центру) ---------------- */

/**
 * Первый эмодзи набора — «сердечко» быстрого отклика, как в Instagram.
 * Набор задаёт сервер, поэтому панель и мгновенная реакция не разъедутся.
 */
const quickEmoji = computed(() => stories.reactionKinds[0] ?? '❤️')

/** Вспышки: эмодзи, вылетающие из точки тапа. */
const bursts = ref<{ id: number; emoji: string; x: number; y: number }[]>([])
let burstSeq = 0

/** Показывает вспышку реакции в точке тапа (координаты — внутри сцены). */
const spawnBurst = (emoji: string, x: number, y: number) => {
  const id = ++burstSeq
  bursts.value = [...bursts.value, { id, emoji, x, y }]
  window.setTimeout(() => {
    bursts.value = bursts.value.filter((burst) => burst.id !== id)
  }, 800)
}

/** Ставит «сердечко» на историю — вызывается тапом по центру сцены. */
const quickReact = (x: number, y: number) => {
  const entry = current.value
  // На своей истории реакции не ставят (сервер её отклонит) — и вспышки нет.
  if (!entry || entry.isMine) return
  spawnBurst(quickEmoji.value, x, y)
  void stories.react(entry.story.id, quickEmoji.value)
}

/**
 * Тап по сцене: по краям — назад/вперёд, по центру — быстрая реакция.
 *
 * Жест один и тот же — одиночный тап (двойной тап человеку неочевиден): края
 * заняты стрелками листания, поэтому центр отдан реакции, а листать можно ещё
 * свайпом. Свайпы и удержание сюда не попадают — это жесты корневого
 * обработчика.
 */
const onStageTap = (event: PointerEvent) => {
  if (gestureAxis !== 'none' || dragX.value !== 0 || dragY.value !== 0) return
  const stage = event.currentTarget as HTMLElement | null
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5
  const zone = storyTapZone(ratio)
  if (zone === 'previous') previous()
  else if (zone === 'next') next()
  else quickReact(event.clientX - rect.left, event.clientY - rect.top)
}

/**
 * Клик по зоне от клавиатуры и скринридера листает сразу: координат у него нет,
 * поэтому его разбирает не `onStageTap` (мышь и палец приходят с `detail > 0`).
 */ const onZoneClick = (event: MouseEvent, direction: 'left' | 'right') => {
  if (event.detail !== 0) return
  if (direction === 'left') previous()
  else next()
}

/** Подгружает соседние кадры, чтобы перелистывание было без «мигания». */
const preloadNeighbours = () => {
  const entry = current.value
  if (!entry) return
  for (const neighbour of [nextStory(flat.value, entry), previousStory(flat.value, entry)]) {
    if (!neighbour || isVideoStory(neighbour.story.mime_type)) continue
    const image = new Image()
    image.src = mediaUrl(neighbour.story.media_url)
  }
}

const onVideoProgress = () => {
  const el = videoEl.value
  if (!el || !el.duration) return
  progress.value = Math.min(1, el.currentTime / el.duration)
}

const next = () => {
  const entry = current.value
  if (!entry) {
    emit('close')
    return
  }
  const following = nextStory(flat.value, entry)
  if (!following) {
    emit('close')
    return
  }
  currentId.value = following.story.id
}

const previous = () => {
  const entry = current.value
  if (!entry) return
  const before = previousStory(flat.value, entry)
  currentId.value = before ? before.story.id : entry.story.id
}

const removeCurrent = async () => {
  const entry = current.value
  if (!entry) return
  // Заранее запоминаем, к чему перейти: после удаления этой истории в ленте её уже
  // не будет, и «следующая» должна считаться по списку без неё.
  const following = nextStory(flat.value, entry)
  const removed = await stories.remove(entry.story.id)
  if (!removed) return
  if (following && flat.value.some((item) => item.story.id === following.story.id)) {
    currentId.value = following.story.id
    return
  }
  emit('close')
}

/** Показ истории отмечаем просмотренным (у чужой — один раз). */
watch(currentId, () => preloadNeighbours())

/* ---------------- Реакции ---------------- */

/** Развёрнут ли полный набор эмодзи (кнопка «ещё»). */
const expanded = ref(false)

const storyReactions = computed(() => current.value?.story.reactions ?? [])

/**
 * Какие эмодзи показывать. В свёрнутом виде — быстрый ряд из набора сервера
 * плюс всё, что уже стоит на истории: снять свою реакцию можно только тапом по
 * тому же эмодзи, поэтому он обязан быть на виду.
 */
const visibleKinds = computed(() => {
  if (expanded.value) return stories.reactionKinds
  return quickReactions(stories.reactionKinds, storyReactions.value, stories.reactionsPrimary)
})

const countOf = (emoji: string): number =>
  storyReactions.value.find((item) => item.emoji === emoji)?.count ?? 0

const isMineReaction = (emoji: string): boolean =>
  storyReactions.value.find((item) => item.emoji === emoji)?.mine ?? false

const reactionTitle = (emoji: string): string => {
  const mine = isMineReaction(emoji)
  const count = countOf(emoji)
  if (mine) return 'Убрать свою реакцию'
  if (count > 0) return `${count} ${count === 1 ? 'реакция' : 'реакций'} — добавить свою`
  return 'Поставить реакцию'
}

const onReact = (emoji: string): void => {
  const entry = current.value
  if (!entry) return
  void stories.react(entry.story.id, emoji)
}

/* ---------------- Ответ текстом ---------------- */

/**
 * Текст ответа. Отправляет его родитель (`emit('reply')`): у него есть доступ
 * к личному чату автора, шифрованию E2EE и очереди «Ждёт сети» — дублировать
 * эту логику в просмотрщике нельзя.
 */
const replyText = ref('')

const sendReply = (): void => {
  const entry = current.value
  const text = replyText.value.trim()
  if (!entry || entry.isMine || !text) return
  emit('reply', { storyId: entry.story.id, authorId: entry.author.id, text })
  // Поле чистим сразу: ответ отправляется оптимистично, как обычное сообщение.
  replyText.value = ''
}

/* ---------------- Аудитория своей истории ---------------- */

/** Панель «кто смотрел» открыта (только для своей истории). */
const audienceOpen = ref(false)
const audience = ref<StoryAudience | null>(null)
const audienceLoading = ref(false)
const audienceError = ref('')
/** Id истории, для которой уже загружена аудитория — чтобы не дёргать API зря. */
let audienceStoryId: number | null = null

const audienceSections = computed(() =>
  audience.value ? buildAudienceSections(audience.value) : []
)

const viewsHint = computed(() => {
  const data = audience.value
  if (!data) return ''
  return audienceViewsHint(data.views.length, data.views_total)
})

/** Аватар пользователя в списке (пустая строка — рисуем инициалы). */
const avatarOf = (user: StoryAuthor): string => {
  const path = avatarUrlOf(user)
  return path ? mediaUrl(path) : ''
}

const openAudience = async (): Promise<void> => {
  const entry = current.value
  if (!entry || !entry.isMine) return
  audienceOpen.value = true
  // Повторное открытие по той же истории — показываем уже загруженное.
  if (audienceStoryId === entry.story.id && audience.value) return
  await loadAudience(entry.story.id)
}

/** Перечитывает аудиторию истории (для открытой панели — после реакции). */
const loadAudience = async (storyId: number): Promise<void> => {
  audienceLoading.value = true
  audienceError.value = ''
  try {
    audience.value = await fetchStoryAudience(storyId)
    audienceStoryId = storyId
  } catch (error) {
    audience.value = null
    audienceStoryId = null
    audienceError.value = getErrorMessage(error, 'Не удалось загрузить аудиторию')
  } finally {
    audienceLoading.value = false
  }
}

// Пришла реакция (событие по сокету → лента перечитана): панель «Аудитория»
// держит данные в кэше на время просмотра, поэтому обновляем её, только если
// она открыта на той же истории — иначе автор увидит старый список.
watch(
  () => stories.groups,
  () => {
    const entry = current.value
    if (audienceOpen.value && entry && audienceStoryId === entry.story.id) {
      void loadAudience(entry.story.id)
    }
  }
)

const closeAudience = (): void => {
  audienceOpen.value = false
}

const markSeen = () => {
  const entry = current.value
  if (entry) void stories.markViewed(entry.story.id)
}

const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'ArrowRight') next()
  else if (event.key === 'ArrowLeft') previous()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  markSeen()
  startTimer()
})

onBeforeUnmount(() => {
  stopTimer()
  window.removeEventListener('keydown', onKey)
})

// Смена истории: обнуляем прогресс, отмечаем просмотр и запускаем показ заново.
watch(currentId, () => {
  progress.value = 0
  // Панель реакций у каждой истории своя — свёрнутый вид по умолчанию.
  expanded.value = false
  // Вспышка реакции относится к прошлой истории — на новой её быть не должно.
  bursts.value = []
  // Недописанный ответ тоже не переносим на следующую историю.
  replyText.value = ''
  // Плашка сбоя видео — про конкретный файл: у следующей истории её нет.
  videoFailed.value = false
  // Аудитория тоже про конкретную историю: закрываем и забываем загруженное.
  audienceOpen.value = false
  audience.value = null
  audienceStoryId = null
  markSeen()
  startTimer()
})

// Истории могли истечь/удалиться, пока просмотрщик открыт — тогда закрываемся.
watch(flat, (list) => {
  if (!list.some((entry) => entry.story.id === currentId.value)) emit('close')
})
</script>

<style scoped>
.story-viewer {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  background: #05070a;
  color: #f2f5f8;
}

.viewer-head {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: calc(12px + env(safe-area-inset-top, 0px)) 14px 8px;
}

.viewer-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-weight: 600;
}

.viewer-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.viewer-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.viewer-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.25;
}

.viewer-age {
  font-size: 12.5px;
  line-height: 1.25;
  opacity: 0.72;
}

.viewer-icon {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.viewer-icon + .viewer-icon {
  margin-left: 0;
}

.viewer-icon:hover {
  background: rgba(255, 255, 255, 0.12);
}

.viewer-bars {
  display: flex;
  gap: 5px;
  padding: 2px 14px 10px;
}

.viewer-bar {
  flex: 1;
  height: 3px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.25);
  overflow: hidden;
}

.viewer-bar-fill {
  display: block;
  height: 100%;
  background: #f2f5f8;
  transition: width 0.1s linear;
}

.viewer-stage {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.viewer-media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* Видео не проигралось: вместо чёрного полотна — объяснение и ссылка на файл
   (в Safari он может открыться: движки декодируют разные форматы). */
.viewer-failed {
  position: absolute;
  inset: auto 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  border-radius: var(--ms-radius-lg);
  background: rgba(0, 0, 0, 0.62);
  color: #e8edf2;
  text-align: center;
}

.viewer-failed-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.45;
}

.viewer-failed-link {
  color: var(--ms-accent);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
}

.viewer-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 32%;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.viewer-zone.left {
  left: 0;
  justify-content: flex-start;
  padding-left: 6px;
}

.viewer-zone.right {
  right: 0;
  justify-content: flex-end;
  padding-right: 6px;
}

.viewer-foot {
  padding: 12px 18px calc(20px + env(safe-area-inset-bottom, 0px));
  text-align: center;
}

/* ---------- Реакции ---------- */
.viewer-reactions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  /* Панель не должна пачкать жесты показа (пауза/свайп уходят только ей). */
  touch-action: manipulation;
}

.viewer-reactions.is-own {
  min-height: 30px;
}

.viewer-reactions-hint {
  font-size: 12.5px;
  opacity: 0.6;
}

.reaction-btn,
.reaction-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 3px 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.reaction-btn {
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    transform 0.1s ease;
}

.reaction-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.reaction-btn:active {
  transform: scale(0.94);
}

/* Есть чужие реакции — кнопка заметнее; своя — обведена акцентом. */
.reaction-btn.used {
  background: rgba(255, 255, 255, 0.18);
}

.reaction-btn.mine {
  border-color: var(--ms-accent);
  background: color-mix(in srgb, var(--ms-accent) 30%, transparent);
}

.reaction-btn.more {
  padding: 3px 8px;
}

.reaction-emoji {
  font-size: 17px;
  line-height: 1;
}

.reaction-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}

/* Вспышка быстрой реакции: эмодзи вылетает из точки тапа. */
.reaction-burst {
  position: absolute;
  transform: translate(-50%, -50%);
  font-size: 46px;
  line-height: 1;
  pointer-events: none;
  animation: story-burst 0.7s ease-out forwards;
}

@keyframes story-burst {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.4);
  }
  25% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.15);
  }
  60% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -150%) scale(1.05);
  }
}

.viewer-caption {
  margin: 0 auto;
  max-width: 34rem;
  font-size: 14.5px;
  line-height: 1.4;
}

.viewer-views {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 12.5px;
  opacity: 0.75;
}

.viewer-views-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  font: inherit;
  padding: 3px 10px;
  cursor: pointer;
}

.viewer-views-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}

.viewer-views-label {
  opacity: 0.75;
}

/* ---------- Ответ на историю ---------- */
.viewer-reply {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 34rem;
  margin: 10px auto 0;
  /* Поле перехватывает жесты показа: набор текста не листает истории. */
  touch-action: manipulation;
}

.viewer-reply-input {
  flex: 1;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  font: inherit;
  font-size: 14.5px;
  padding: 8px 14px;
}

.viewer-reply-input::placeholder {
  color: inherit;
  opacity: 0.6;
}

.viewer-reply-input:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: 1px;
}

.viewer-reply-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  color: inherit;
  cursor: pointer;
}

.viewer-reply-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.24);
}

.viewer-reply-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ---------- Панель «Аудитория истории» ---------- */
.audience-backdrop {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

/* Лист — обычная поверхность приложения: в тёмной теме он тёмный, в светлой
   светлый, токены берут это на себя. */
.audience-sheet {
  width: min(520px, 100%);
  max-height: 72%;
  overflow-y: auto;
  padding: 12px 16px calc(18px + env(safe-area-inset-bottom, 0px));
  border-radius: 18px 18px 0 0;
  background: var(--ms-surface);
  color: var(--ms-text);
  text-align: left;
}

.audience-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.audience-title {
  flex: 1;
  min-width: 0;
  font-family: var(--ms-font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--ms-text-strong);
}

.audience-status {
  margin: 10px 0;
  font-size: 13px;
  color: var(--ms-muted-2);
}

.audience-status.error {
  color: var(--ms-danger);
}

.audience-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ms-muted-2);
}

.audience-group {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--ms-border);
}

.audience-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  min-height: 28px;
  padding: 2px 9px;
  border: 1px solid var(--ms-border);
  border-radius: 14px;
  background: var(--ms-surface-2);
  font-size: 15px;
}

.audience-count {
  font-size: 12px;
  color: var(--ms-muted-2);
  font-variant-numeric: tabular-nums;
}

.audience-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.audience-user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px 3px 3px;
  border-radius: 14px;
  background: var(--ms-surface-2);
  font-size: 13px;
  color: var(--ms-text);
}

.audience-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  flex: 0 0 auto;
}

.audience-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.audience-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
