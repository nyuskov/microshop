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

    <div v-if="broken" class="am-sub">
      <span class="am-error">Не удалось воспроизвести аудио</span>
    </div>
    <div v-else class="am-sub">
      <span class="am-name">
        <q-icon :name="icon('volume_up')" size="15px" />
        {{ name }}
      </span>
      <span v-if="!durationKnown && size" class="am-size">{{ formatBytes(size) }}</span>
      <!-- Скорость: 1× → 1.5× → 2×. Общая для всех голосовых (см. utils/playbackSpeed). -->
      <button
        class="am-speed"
        :title="`Скорость ${speedLabel(playbackSpeed)} — нажмите, чтобы изменить`"
        @click="onCycleSpeed"
      >
        {{ speedLabel(playbackSpeed) }}
      </button>
      <!-- Расшифровка голосового: кнопка есть только там, где браузер умеет
           распознавать записи (см. utils/voiceRecognition). -->
      <button
        v-if="recognitionAvailable"
        class="am-transcribe"
        :class="{ busy: transcript?.status === 'running' }"
        :title="transcribeHint"
        :aria-label="transcribeHint"
        @click="toggleTranscript"
      >
        {{ transcribeLabel }}
      </button>
    </div>

    <!-- Расшифровка: распознаёт устройство, текст никуда не отправляется. -->
    <div v-if="transcript && transcript.status !== 'running'" class="am-transcript">
      <p v-if="transcript.status === 'ready'" class="am-transcript-text">{{ transcript.text }}</p>
      <p v-else class="am-transcript-error">{{ transcript.error }}</p>
      <!-- Кнопка в шапке — единый переключатель «В текст / Распознаём… / Скрыть
           текст», поэтому здесь только то, чего в шапке нет: копирование
           готового текста и повтор после ошибки. -->
      <div
        v-if="transcript.status === 'ready' || transcript.status === 'failed'"
        class="am-transcript-actions"
      >
        <button
          v-if="transcript.status === 'ready'"
          class="am-transcript-btn"
          @click="copyTranscript"
        >
          Скопировать
        </button>
        <!-- «Ещё раз» есть и при готовом тексте: после улучшений распознавания
             старый текст хочется переиграть, а не только скрыть. -->
        <button class="am-transcript-btn" @click="retryTranscript">Ещё раз</button>
      </div>
      <!-- Язык выбирается тут же, а не в настройках: неправильный язык —
           главная причина чужого текста («Привет» → «private»). -->
      <div class="am-lang">
        <span class="am-lang-title">Язык речи</span>
        <div class="am-lang-list">
          <button
            class="am-lang-btn"
            :class="{ active: speechLanguage === '' }"
            :aria-pressed="speechLanguage === ''"
            @click="setSpeechLanguage('')"
          >
            Авто
          </button>
          <button
            v-for="item in SPEECH_LANGUAGES"
            :key="item.code"
            class="am-lang-btn"
            :class="{ active: speechLanguage === item.code }"
            :aria-pressed="speechLanguage === item.code"
            @click="setSpeechLanguage(item.code)"
          >
            {{ item.label }}
          </button>
        </div>
        <p v-if="transcript.status === 'failed'" class="am-lang-hint">
          Если слова не те — попробуйте другой язык и нажмите «Ещё раз».
        </p>
      </div>
      <p class="am-transcript-note">
        Распознаёт браузер устройства — в E2EE-чате текст на сервер не уходит, но распознавание
        может обращаться к сервису браузера.
      </p>
    </div>

    <p v-if="transcript?.status === 'running'" class="am-transcript-note am-transcript-note--live">
      {{ transcript.text || 'Слушаем запись…' }}
      <!-- Язык виден здесь, а не в настройках: если текст вышел чужими словами,
           причина видна сразу («private» вместо «привет» — это английская
           модель). -->
      <span class="am-lang-used">{{ speechLanguageInUse }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, onMounted, ref, watch } from 'vue'
import { formatClock } from '@/services/recorder'
import { cyclePlaybackSpeed, playbackSpeed, speedLabel } from '@/utils/playbackSpeed'
import {
  clearTranscript,
  recognizeVoice,
  setSpeechLanguage,
  SPEECH_LANGUAGES,
  speechLanguage,
  speechLanguageInUse,
  speechRecognitionSupported,
  transcriptActionFor,
  transcriptOf
} from '@/utils/voiceRecognition'

const props = defineProps<{
  /** Id сообщения: по нему помним расшифровку при перерисовке ленты. */
  messageId: number
  src: string
  name: string
  size?: number | null
}>()

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

// ---------- Расшифровка в текст (F4) ----------

/** Умеет ли браузер распознавать записи — иначе кнопки нет вообще. */
const recognitionAvailable = speechRecognitionSupported()

/** Текущая расшифровка этого сообщения (undefined — не расшифровывали). */
const transcript = computed(() => transcriptOf(props.messageId))

const transcribeHint = computed(() => {
  const action = transcriptActionFor(transcript.value)
  if (action === 'cancel') return 'Распознаём — нажмите, чтобы отменить'
  if (action === 'hide') return 'Скрыть расшифровку'
  return 'Расшифровать голосовое в текст'
})

/** Подпись кнопки — по действию: на телефоне подсказка не видна, её заменяет текст. */
const transcribeLabel = computed(() => {
  const action = transcriptActionFor(transcript.value)
  if (action === 'cancel') return 'Распознаём…'
  if (action === 'hide') return 'Скрыть текст'
  return 'В текст'
})

/**
 * Кнопка «В текст»: расшифровывает, отменяет идущее распознавание или скрывает
 * готовый текст — что именно, решает `transcriptActionFor` (единообразно).
 */
const toggleTranscript = () => {
  const current = transcript.value
  if (transcriptActionFor(current) === 'recognize') {
    startRecognition()
    return
  }
  clearTranscript(props.messageId)
}

/** Пробует распознать ещё раз — кнопка «Ещё раз» в блоке с ошибкой. */
const retryTranscript = () => startRecognition()

/**
 * Запуск распознавания: сначала пауза воспроизведения — расшифровка «читает» тот
 * же файл, и играющий звук сбивал бы и слух, и распознавание.
 */
const startRecognition = () => {
  const audio = audioRef.value
  if (audio && isPlaying.value) audio.pause()
  void recognizeVoice(props.messageId, props.src)
}

const copyTranscript = async () => {
  const text = transcript.value?.text
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* нет разрешения на буфер обмена — текст видно и так */
  }
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

.am-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: var(--ms-fs-xs);
  min-width: 0;
}

.am-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ms-muted, #71808d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.am-size {
  color: var(--ms-bubble-time, #8a98a3);
  flex-shrink: 0;
}

.am-error {
  color: var(--ms-danger, #d64545);
}

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
.am-transcribe {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--ms-accent, #2ea25e);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 8px;
  cursor: pointer;
}

.am-transcribe:hover {
  background: var(--ms-accent-soft, rgba(46, 162, 94, 0.12));
}

.am-transcribe.busy {
  color: var(--ms-muted, #71808d);
  cursor: default;
}

/* Расшифровка под голосовым: границу даёт полоса слева, как у цитаты. */
.am-transcript {
  margin-top: 6px;
  padding-left: 8px;
  border-left: 2px solid var(--ms-border, #dfe5ea);
}

.am-transcript-text {
  margin: 0;
  font-size: var(--ms-fs-sm);
  line-height: 1.35;
  color: var(--ms-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.am-transcript-error {
  margin: 0;
  font-size: var(--ms-fs-xs);
  color: var(--ms-danger, #d64545);
}

.am-transcript-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.am-transcript-btn {
  border: none;
  background: transparent;
  color: var(--ms-accent, #2ea25e);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  padding: 0;
  cursor: pointer;
}

.am-transcript-note {
  margin: 4px 0 0;
  font-size: var(--ms-fs-xs);
  line-height: 1.3;
  color: var(--ms-muted, #71808d);
}

.am-transcript-note--live {
  font-style: italic;
}

.am-lang-used {
  margin-left: 4px;
  font-style: normal;
  color: var(--ms-muted, #71808d);
}

/* Язык речи: нужен там же, где и текст, — иначе человек не поймёт, почему
   «Привет» распознался как «private». */
.am-lang {
  margin-top: 6px;
}

.am-lang-title {
  display: block;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted, #71808d);
}

.am-lang-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}

.am-lang-btn {
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 8px;
  background: transparent;
  color: var(--ms-text);
  font-size: var(--ms-fs-xs);
  line-height: 1.2;
  padding: 3px 7px;
  cursor: pointer;
}

.am-lang-btn.active {
  border-color: var(--ms-accent, #2ea25e);
  background: var(--ms-accent-soft, rgba(46, 162, 94, 0.12));
  color: var(--ms-accent, #2ea25e);
}

.am-lang-hint {
  margin: 4px 0 0;
  font-size: var(--ms-fs-xs);
  line-height: 1.3;
  color: var(--ms-muted, #71808d);
}
</style>
