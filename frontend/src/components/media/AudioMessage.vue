<template>
  <div class="audio-message">
    <audio
      ref="audioRef"
      class="am-audio"
      :src="src"
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @ended="onEnded"
      @play="isPlaying = true"
      @pause="isPlaying = false"
      @error="onError"
    ></audio>

    <MediaMessageShell
      :message-id="messageId"
      :src="src"
      :name="name"
      :size-label="!durationKnown && size ? formatBytes(size) : ''"
      :broken="broken"
      broken-text="Не удалось воспроизвести аудио"
    >
      <template #player>
        <div class="am-row">
          <button
            class="am-play"
            :class="{ playing: isPlaying }"
            :title="isPlaying ? 'Пауза' : 'Слушать'"
            @click="toggle"
          >
            <q-icon :name="icon(isPlaying ? 'pause' : 'play_arrow')" size="24px" />
          </button>
          <div class="am-track" title="Перемотка" @click="seek">
            <div class="am-fill" :style="progressStyle()"></div>
          </div>
          <span class="am-time">{{ timeLabel }}</span>
        </div>
      </template>

      <template #name-icon>
        <q-icon :name="icon('volume_up')" size="15px" />
      </template>

      <!-- Скорость: 1× → 1.5× → 2×. Общая для всех голосовых (см. utils/playbackSpeed). -->
      <template #extra>
        <button
          class="am-speed"
          :title="`Скорость ${speedLabel(playbackSpeed)} — нажмите, чтобы изменить`"
          @click="onCycleSpeed"
        >
          {{ speedLabel(playbackSpeed) }}
        </button>
      </template>
    </MediaMessageShell>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, onMounted, ref, watch } from 'vue'
import { formatClock } from '@/services/recorder'
import { cyclePlaybackSpeed, playbackSpeed, speedLabel } from '@/utils/playbackSpeed'
import MediaMessageShell from '@/components/media/MediaMessageShell.vue'

const props = defineProps<{
  /** Id сообщения: по нему помним расшифровку при перерисовке ленты. */
  messageId: number
  src: string
  name: string
  size?: number | null
}>()
void props

const audioRef = ref<HTMLAudioElement | null>(null)
const isPlaying = ref(false)
const current = ref(0)
const duration = ref(0)
const durationKnown = ref(false)
const broken = ref(false)

const onLoadedMetadata = () => {
  const audio = audioRef.value
  if (!audio || !Number.isFinite(audio.duration)) return
  duration.value = audio.duration
  durationKnown.value = true
}

const onTimeUpdate = () => {
  const audio = audioRef.value
  if (audio) current.value = audio.currentTime
}

const onEnded = () => {
  isPlaying.value = false
  current.value = 0
  const audio = audioRef.value
  if (audio) audio.currentTime = 0
}

const onError = () => {
  broken.value = true
}

const toggle = () => {
  const audio = audioRef.value
  if (!audio) return
  if (isPlaying.value) {
    audio.pause()
    return
  }
  void audio.play().catch(() => {
    broken.value = true
  })
}

const timeLabel = computed<string>(() => {
  if (broken.value) return ''
  const total = durationKnown.value ? formatClock(duration.value) : '…'
  return `${formatClock(current.value)} / ${total}`
})

const progressStyle = (): Record<string, string> => {
  let percent = 0
  if (durationKnown.value && duration.value > 0) {
    percent = (current.value / duration.value) * 100
  }
  const clamped = Math.min(100, Math.max(0, percent))
  return { width: `${clamped}%` }
}

const seek = (event: MouseEvent) => {
  if (!durationKnown.value) return
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0) return
  const ratio = (event.clientX - rect.left) / rect.width
  const audio = audioRef.value
  if (audio) {
    audio.currentTime = Math.min(duration.value, Math.max(0, ratio * duration.value))
  }
}

const formatBytes = (size: number | null | undefined): string => {
  if (!size) return ''
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}

/** Скорость задаётся на самом элементе `<audio>` — держим её в актуальном виде. */
const applySpeed = () => {
  const audio = audioRef.value
  if (audio) audio.playbackRate = playbackSpeed.value
}

onMounted(applySpeed)
watch(playbackSpeed, applySpeed)

const onCycleSpeed = () => {
  cyclePlaybackSpeed()
  applySpeed()
}
</script>

<style scoped>
.audio-message {
  min-width: 210px;
  max-width: 260px;
  user-select: none;
}

.am-audio {
  display: none;
}

.am-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.am-play {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: var(--ms-accent, #2ea25e);
  color: var(--ms-on-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 1.05rem;
  flex-shrink: 0;
  transition:
    transform 0.12s,
    background 0.12s;
}

.am-play i {
  display: block;
  line-height: 1;
}

.am-play:hover {
  transform: scale(1.06);
  background: var(--ms-accent-strong, #288e52);
}

.am-track {
  flex: 1;
  height: 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ms-bubble-text) 16%, transparent);
  cursor: pointer;
  overflow: hidden;
}

.am-fill {
  height: 100%;
  background: var(--ms-accent, #2ea25e);
  border-radius: 4px;
  width: 0%;
}

.am-time {
  font-size: var(--ms-fs-xs);
  color: var(--ms-bubble-time, #8a98a3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  min-width: 74px;
  text-align: right;
}

/* В «сломанном» состоянии кнопки скорости нет, поэтому к правому краю кнопку
   расшифровки двигаем отдельным правилом (иначе два `margin-left: auto` в одной
   строке растащили бы кнопки к центру). */
/* Кнопка скорости воспроизведения (1×/1.5×/2×) */
.am-speed {
  margin-left: auto;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--ms-accent, #2ea25e);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 2px 6px;
  border-radius: 8px;
  cursor: pointer;
}

.am-speed:hover {
  background: var(--ms-accent-soft, rgba(46, 162, 94, 0.12));
}

/* Кнопка «В текст»: рядом с подписью файла, вторичная по весу. */
</style>
