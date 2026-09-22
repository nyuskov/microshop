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
      :broken-text="brokenText"
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
          <div
            class="am-track"
            role="slider"
            :aria-label="'Перемотка'"
            :aria-valuemin="0"
            :aria-valuemax="Math.round(duration)"
            :aria-valuenow="Math.round(current)"
            :title="t('Перемотка')"
            @pointerdown="onSeekStart"
            @pointermove="onSeekMove"
            @pointerup="onSeekEnd"
            @pointercancel="onSeekEnd"
          >
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
import { t } from '@/i18n'

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
const brokenText = ref(t('Не удалось воспроизвести аудио'))

/**
 * Причина недоступности по коду `MediaError`.
 *
 * Говорить всегда «не удалось воспроизвести» — значит скрывать от человека то,
 * что он может сделать: при коде 2 виновата связь (повторить), при 3 — файл на
 * сервере битый, при 4 — формат не тот, что умеет это устройство (и тогда путь
 * один: расшифровка текстом).
 */
const brokenTexts: Record<number, string> = {
  1: t('Загрузка записи прервана'),
  2: t('Запись не загрузилась — проверьте связь'),
  3: t('Запись повреждена — файл не читается'),
  4: t('Устройство не умеет играть этот формат')
}

const onLoadedMetadata = () => {
  const audio = audioRef.value
  if (!audio || !Number.isFinite(audio.duration)) return
  duration.value = audio.duration
  durationKnown.value = true
}

const onTimeUpdate = () => {
  // Во время перемотки пальцем позицию ведёт жест: `timeupdate` перебивал бы её скачками.
  if (seekDragging.value) return
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
  const code = audioRef.value?.error?.code ?? 0
  brokenText.value = brokenTexts[code] ?? brokenText.value
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

/**
 * Перемотка: тап по полосе и протяжка пальцем (как в Телеграме).
 *
 * Пока палец ведёт — двигаем только позицию на экране, а самому плееру отдаём
 * её при отпускании: иначе запись «дёргается» на каждом сдвиге. Полоса тонкая,
 * поэтому область нажатия расширена невидимым слоем (`.am-track::after`).
 */
const seekDragging = ref(false)
/**
 * Прямоугольник полосы на момент начала жеста.
 *
 * Считать долю от ЖИВОГО прямоугольника нельзя: пока палец ведёт, подпись
 * времени меняет ширину, полоса (flex: 1) пересчитывается — и позиция начинает
 * «убегать» от пальца (замер: на 75 % пальца выходило 59 %, на 90 % — 49 %).
 */
let seekRect: { left: number; width: number } | null = null

const seekRatio = (
  event: PointerEvent,
  rect: DOMRect | { left: number; width: number }
): number => {
  if (rect.width <= 0) return 0
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
}

const onSeekStart = (event: PointerEvent) => {
  if (!durationKnown.value) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  seekDragging.value = true
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  seekRect = { left: rect.left, width: rect.width }
  // Захват указателя: палец может уехать за пределы полосы — жест всё равно наш.
  // ГРАБЛЯ: у синтетических событий и у уже отпущенного указателя захват бросает
  // `NotFoundError`, а он через `app.config.errorHandler` показывал фатальный
  // экран вместо перемотки. Без захвата жест тоже работает (просто обрывается на
  // выходе за полосу), поэтому ошибку глушим.
  try {
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch {
    /* указателя уже нет — перематываем без захвата */
  }
  current.value = seekRatio(event, seekRect) * duration.value
}

const onSeekMove = (event: PointerEvent) => {
  if (!seekDragging.value || !seekRect) return
  current.value = seekRatio(event, seekRect) * duration.value
}

const onSeekEnd = () => {
  if (!seekDragging.value) return
  seekDragging.value = false
  seekRect = null
  const audio = audioRef.value
  if (audio) audio.currentTime = current.value
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
  /* `overflow` НЕ скрываем: оно срезало бы невидимую область нажатия (::after).
     Сам наполнитель шире полосы не бывает — он растёт по ширине в процентах. */
  position: relative;
  /* Протяжка по полосе — наша: без этого браузер листал бы ею ленту. */
  touch-action: none;
}

/* Палец толще полосы 6 px: область нажатия/протяжки выше и ниже неё. */
.am-track::after {
  content: '';
  position: absolute;
  inset: -14px 0;
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

/* Значок расшифровки («↳A»): рядом с подписью файла, вторичный по весу. */
</style>
