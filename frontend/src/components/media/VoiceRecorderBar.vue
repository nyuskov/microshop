<template>
  <div class="voice-recorder">
    <!-- Ошибка доступа к микрофону -->
    <template v-if="errorText">
      <button class="vr-btn danger" :title="t('Закрыть')" @click="cancel">
        <q-icon :name="icon('close')" size="20px" />
      </button>
      <span class="vr-err-icon"><q-icon :name="icon('mic_off')" size="20px" /></span>
      <span class="vr-err-text">{{ errorText }}</span>
      <button class="vr-btn accent" :title="t('Повторить')" @click="retry">
        <q-icon :name="icon('refresh')" size="20px" />
      </button>
    </template>

    <!-- Состояние записи -->
    <template v-else-if="state === 'recording'">
      <button class="vr-btn danger" :title="t('Отменить запись')" @click="cancel">
        <q-icon :name="icon('close')" size="20px" />
      </button>
      <span class="vr-dot"></span>
      <span class="vr-label">{{ t('Запись голосового сообщения') }}</span>
      <span class="vr-timer">{{ formatClock(durationMs / 1000) }}</span>
      <button class="vr-btn accent" :title="t('Остановить запись')" @click="stopRecording">
        <q-icon :name="icon('stop')" size="20px" />
      </button>
    </template>

    <!-- Предпросмотр перед отправкой -->
    <template v-else>
      <button class="vr-btn danger" :title="t('Удалить')" @click="discard">
        <q-icon :name="icon('delete')" size="20px" />
      </button>
      <button
        class="vr-play"
        :class="{ playing: isPlaying }"
        :title="t('Прослушать')"
        @click="togglePlay"
      >
        <q-icon :name="icon(isPlaying ? 'pause' : 'play_arrow')" size="22px" />
      </button>
      <span class="vr-label">{{ t('Голосовое сообщение') }}</span>
      <span class="vr-timer">{{ formatClock(durationMs / 1000) }}</span>
      <button class="vr-btn accent" :title="t('Отправить')" :disabled="sending" @click="send">
        <q-icon :name="icon('send')" size="18px" />
      </button>
    </template>

    <audio ref="previewAudioRef" class="vr-hidden-audio"></audio>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '@/i18n'
import {
  formatClock,
  pickMimeType,
  stopMediaStream,
  describeMediaError,
  type RecordedMedia
} from '@/services/recorder'

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'send', payload: RecordedMedia): void
}>()

const state = ref<'recording' | 'preview'>('recording')
const durationMs = ref(0)
const isPlaying = ref(false)
const sending = ref(false)
const errorText = ref('')
const previewAudioRef = ref<HTMLAudioElement | null>(null)

let mediaStream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let blob: Blob | null = null
let durationTimer: number | undefined
let maxTimer: number | undefined
let previewUrl: string | null = null
let disposed = false

const clearTimers = () => {
  if (durationTimer !== undefined) window.clearInterval(durationTimer)
  if (maxTimer !== undefined) window.clearTimeout(maxTimer)
  durationTimer = undefined
  maxTimer = undefined
}

const beginRecording = async () => {
  try {
    const mime = pickMimeType('audio')
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    })
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(mediaStream, { mimeType: mime })
    } catch {
      rec = new MediaRecorder(mediaStream)
    }
    recorder = rec
    chunks = []
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      finalize()
    }
    recorder.start()
    state.value = 'recording'
    durationMs.value = 0
    durationTimer = window.setInterval(() => {
      durationMs.value += 100
    }, 100)
    // Автоостановка — 2 минуты.
    maxTimer = window.setTimeout(() => {
      if (state.value === 'recording') stopRecording()
    }, 120_000)
  } catch (error) {
    // Нет доступа к микрофону — показываем понятную ошибку и кнопку «Повторить».
    errorText.value = describeMediaError(error)
    dispose()
  }
}

const retry = () => {
  disposed = false
  recorder = null
  mediaStream = null
  errorText.value = ''
  state.value = 'recording'
  void beginRecording()
}

const finalize = () => {
  if (!recorder) return
  blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
  clearTimers()
  stopMediaStream(mediaStream)
  mediaStream = null
  state.value = 'preview'
  previewUrl = URL.createObjectURL(blob)
  if (previewAudioRef.value) {
    previewAudioRef.value.src = previewUrl
  }
}

const stopRecording = () => {
  if (state.value !== 'recording' || !recorder) return
  if (recorder.state === 'recording') {
    recorder.stop()
  }
}

const cancel = () => {
  if (recorder && recorder.state === 'recording') {
    recorder.ondataavailable = null
    recorder.onstop = null
    try {
      recorder.stop()
    } catch {
      /* ignore */
    }
  }
  dispose()
  emit('cancel')
}

const discard = () => {
  dispose()
  emit('cancel')
}

const send = () => {
  if (!blob || sending.value) return
  sending.value = true
  const payload: RecordedMedia = { blob, mime: blob.type, durationMs: durationMs.value }
  dispose()
  emit('send', payload)
}

const togglePlay = () => {
  const audio = previewAudioRef.value
  if (!audio) return
  if (isPlaying.value) {
    audio.pause()
  } else {
    void audio.play().catch(() => undefined)
  }
}

const dispose = () => {
  if (disposed) return
  disposed = true
  clearTimers()
  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop()
    } catch {
      /* ignore */
    }
  }
  recorder = null
  stopMediaStream(mediaStream)
  mediaStream = null
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl)
    previewUrl = null
  }
}

onMounted(() => {
  void beginRecording()
})

onBeforeUnmount(() => {
  dispose()
})
</script>

<style scoped>
.voice-recorder {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
  background: var(--ms-surface);
  border-radius: 12px;
  padding: 7px 12px;
}

/* Состояние ошибки доступа к микрофону */
.vr-err-icon {
  color: var(--ms-danger);
  flex-shrink: 0;
  display: inline-flex;
}

.vr-err-text {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--ms-danger);
  background: var(--ms-danger-bg);
  border-radius: 8px;
  padding: 6px 9px;
}

.vr-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ms-danger);
  animation: vr-blink 1s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes vr-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.vr-label {
  flex: 1;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ms-text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vr-timer {
  font-size: 13px;
  color: var(--ms-muted-2);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.vr-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  flex-shrink: 0;
}

.vr-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.vr-btn.danger {
  background: var(--ms-danger-bg);
  color: var(--ms-danger);
}

.vr-btn.danger:hover {
  background: color-mix(in srgb, var(--ms-danger) 16%, transparent);
}

.vr-btn.accent {
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
}

.vr-btn.accent:hover {
  background: color-mix(in srgb, var(--ms-accent) 16%, transparent);
}

.vr-play {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 1.1rem;
  flex-shrink: 0;
}

.vr-play i {
  display: block;
  line-height: 1;
}

.vr-play:hover {
  background: var(--ms-accent-strong);
}

.vr-hidden-audio {
  display: none;
}
</style>
