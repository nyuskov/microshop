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
      :transcribe-inline="true"
    >
      <template #player>
        <div class="am-row">
          <button
            class="am-play"
            :class="{ playing: isPlaying }"
            :title="isPlaying ? t('Пауза') : t('Слушать')"
            @click="toggle"
          >
            <q-icon :name="icon(isPlaying ? 'pause' : 'play_arrow')" size="24px" />
          </button>
          <div
            class="am-track"
            :class="{ 'am-track-wave': hasWave }"
            role="slider"
            :aria-label="t('Перемотка')"
            :aria-valuemin="0"
            :aria-valuemax="Math.round(duration)"
            :aria-valuenow="Math.round(current)"
            :title="t('Перемотка')"
            @pointerdown="onSeekStart"
            @pointermove="onSeekMove"
            @pointerup="onSeekEnd"
            @pointercancel="onSeekEnd"
          >
            <!-- Реальная волна (громкость из файла): столбики вместо плоской полосы.
                 Считается один раз и кэшируется, поэтому при перерисовке ленты не
                 пересчитывается. Не посчиталась — показываем прежнюю плоскую полосу. -->
            <template v-if="hasWave">
              <i
                v-for="(peak, index) in peaks"
                :key="index"
                class="am-bar"
                :class="{ played: isPlayedBar(index) }"
                :style="barHeight(peak)"
              ></i>
            </template>
            <template v-else>
              <div class="am-fill" :style="progressStyle()"></div>
            </template>
          </div>
          <!-- Бейдж расшифровки — сразу справа от полосы, в одной строке с ней
               (владелец: «рядом с аудиозаписью-полоской ставь сразу справа значок,
               а не снизу»). Время уходит правее него, чтобы бейдж не уезжал под
               палец при перемотке. -->
          <TranscribeButton :message-id="messageId" :src="src" />
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
          :title="
            t('Скорость {speed} — нажмите, чтобы изменить', { speed: speedLabel(playbackSpeed) })
          "
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
import { waveformPeaks } from '@/utils/waveform'
import MediaMessageShell from '@/components/media/MediaMessageShell.vue'
import TranscribeButton from '@/components/media/TranscribeButton.vue'
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
 * Пики громкости для волны: `null` — файл не разобрался (тогда показываем плоскую
 * полосу). Считаются один раз на сообщение, в фоне, чтобы открытие чата не ждало
 * декодирование звука.
 */
const peaks = ref<number[] | null>(null)

/** Есть ли что рисовать волной: сломанный файл волну не показываем. */
const hasWave = computed<boolean>(
  () => !broken.value && Array.isArray(peaks.value) && peaks.value.length > 0
)

/** Доля прослушанного — по ней красим столбики слева направо (как в МАКСе). */
const playedRatio = computed<number>(() => {
  if (!durationKnown.value || duration.value <= 0) return 0
  return Math.min(1, Math.max(0, current.value / duration.value))
})

/** Высота столбика: от 4 до 18 px — плоская запись не должна выглядеть мёртвой. */
const barHeight = (peak: number): Record<string, string> => {
  const value = Math.min(1, Math.max(0, peak))
  return { height: `${Math.round(4 + value * 14)}px` }
}

/** Столбик уже прослушан (весь столбик целиком, а не его часть). */
const isPlayedBar = (index: number): boolean => {
  const bars = peaks.value?.length ?? 0
  if (!bars) return false
  return (index + 1) / bars <= playedRatio.value
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
  if (size < 1024) return `${size} ${t('Б')}`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} ${t('КБ')}`
  return `${(size / (1024 * 1024)).toFixed(1)} ${t('МБ')}`
}

/** Скорость задаётся на самом элементе `<audio>` — держим её в актуальном виде. */
const applySpeed = () => {
  const audio = audioRef.value
  if (audio) audio.playbackRate = playbackSpeed.value
}

/**
 * Волна считается после монтирования: сначала показывается плоская полоса, как
 * раньше, и только когда звук разобран — на её месте появляются столбики. Так
 * открытие чата не ждёт декодирования всех голосовых в ленте.
 */
const loadWave = async () => {
  const bars = await waveformPeaks(props.messageId, props.src)
  if (bars && bars.length) peaks.value = bars
}

onMounted(() => {
  applySpeed()
  void loadWave()
})
watch(playbackSpeed, applySpeed)

const onCycleSpeed = () => {
  cyclePlaybackSpeed()
  applySpeed()
}
</script>

<style scoped>
.audio-message {
  /* Шире, чем было (210–260): в строке плеера теперь ещё бейдж расшифровки справа
     от волны, и волне нужно остаться читаемой (36 столбиков по 2 px). */
  min-width: 240px;
  max-width: 300px;
  user-select: none;
}

.am-audio {
  display: none;
}

.am-row {
  display: flex;
  align-items: center;
  gap: 6px;
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

/* Волна (реальная громкость из файла): столбики вместо плоской полосы. Высоту
   задаёт каждый столбик, поэтому контейнер выше и без своего фона. Расстояние
   между столбиками раскладывает `space-between` — так их число не зависит от
   ширины пузыря и волна никогда не вылезает за полосу. */
.am-track-wave {
  height: 20px;
  border-radius: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1px;
}

.am-track-wave::after {
  /* Полоса стала выше — область нажатия снова примерно на палец. */
  inset: -6px 0;
}

.am-bar {
  width: 2px;
  flex-shrink: 0;
  border-radius: 1px;
  background: currentColor;
  /* Непроигранная часть тише проигранной — видно, где мы в записи. */
  opacity: 0.35;
}

.am-bar.played {
  opacity: 1;
}

.am-time {
  font-size: var(--ms-fs-xs);
  color: var(--ms-bubble-time, #8a98a3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  min-width: 64px;
  text-align: right;
  /* Подпись «0:13 / 0:15» не переносится: в строке плеера иначе выросла бы высота. */
  white-space: nowrap;
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

/* Значок расшифровки («↳Т»): рядом с подписью файла, вторичный по весу. */
</style>
