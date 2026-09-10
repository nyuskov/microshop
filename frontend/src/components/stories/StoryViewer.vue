<template>
  <div
    v-if="current"
    class="story-viewer"
    role="dialog"
    aria-modal="true"
    @click.self="emit('close')"
  >
    <!-- Автор и управление -->
    <header class="viewer-head">
      <span class="viewer-avatar" :style="avatarStyle(authorName)">
        <img v-if="authorAvatar" :src="authorAvatar" alt="" />
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
        title="Удалить историю"
        @click.stop="removeCurrent"
      >
        <q-icon name="delete_outline" size="22px" />
      </button>
      <button class="viewer-icon" type="button" title="Закрыть" @click.stop="emit('close')">
        <q-icon name="close" size="24px" />
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
    <div class="viewer-stage">
      <img
        v-if="!isVideo"
        :src="mediaUrl(current.story.media_url)"
        class="viewer-media"
        alt=""
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
      ></video>

      <!-- Зоны «назад/вперёд» -->
      <button class="viewer-zone left" type="button" title="Предыдущая" @click.stop="previous">
        <q-icon name="chevron_left" size="30px" />
      </button>
      <button class="viewer-zone right" type="button" title="Следующая" @click.stop="next">
        <q-icon name="chevron_right" size="30px" />
      </button>
    </div>

    <footer class="viewer-foot">
      <p v-if="current.story.caption" class="viewer-caption">{{ current.story.caption }}</p>
      <p v-if="current.isMine" class="viewer-views">
        <q-icon name="visibility" size="14px" /> {{ current.story.views }}
      </p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { mediaUrl } from '@/config'
import type { StoryGroup } from '@/services/stories'
import { useStoriesStore } from '@/stores/stories'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import {
  flattenStories,
  formatStoryAge,
  isVideoStory,
  nextStory,
  previousStory,
  type FlatStory
} from '@/utils/stories'

const props = defineProps<{
  groups: StoryGroup[]
  startStoryId: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

/**: Сколько показывать картинку, если это не видео. */
const IMAGE_DURATION_MS = 5000

const stories = useStoriesStore()
const videoEl = ref<HTMLVideoElement | null>(null)
const currentId = ref(props.startStoryId)
const progress = ref(0)
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
  const path = author ? avatarUrlOf(author) : null
  return path ? mediaUrl(path) : ''
})

const authorInitials = computed(() => initials(authorName.value || 'П'))

const age = computed(() => formatStoryAge(current.value?.story.created_at ?? ''))

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
  startedAt = Date.now()
  const tick = () => {
    const elapsed = Date.now() - startedAt
    progress.value = Math.min(1, elapsed / IMAGE_DURATION_MS)
    if (elapsed >= IMAGE_DURATION_MS) {
      next()
      return
    }
    raf = window.requestAnimationFrame(tick)
  }
  raf = window.requestAnimationFrame(tick)
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
</style>
