<template>
  <div class="voice-recorder">
    <!-- Состояние записи -->
    <template v-if="state === 'recording'">
      <button class="vr-btn danger" title="Отменить запись" @click="cancel">
        <i class="pi pi-times"></i>
      </button>
      <span class="vr-dot"></span>
      <span class="vr-label">Запись голосового сообщения</span>
      <span class="vr-timer">{{ formatClock(durationMs / 1000) }}</span>
      <button class="vr-btn accent" title="Остановить запись" @click="stopRecording">
        <i class="pi pi-stop"></i>
      </button>
    </template>

    <!-- Предпросмотр перед отправкой -->
    <template v-else>
      <button class="vr-btn danger" title="Удалить" @click="discard">
        <i class="pi pi-trash"></i>
      </button>
      <button
        class="vr-play"
        :class="{ playing: isPlaying }"
        title="Прослушать"
        @click="togglePlay"
      >
        <i :class="isPlaying ? 'pi pi-pause' : 'pi pi-play'"></i>
      </button>
      <span class="vr-label">Голосовое сообщение</span>
      <span class="vr-timer">{{ formatClock(durationMs / 1000) }}</span>
      <button class="vr-btn accent" title="Отправить" :disabled="sending" @click="send">
        <i class="pi pi-send"></i>
      </button>
    </template>

    <audio ref="previewAudioRef" class="vr-hidden-audio"></audio>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { formatClock, pickMimeType, stopMediaStream, type RecordedMedia } from '@/services/recorder'

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'send', payload: RecordedMedia): void
}>()

const state = ref<'recording' | 'preview'>('recording')
const durationMs = ref(0)
const isPlaying = ref(false)
const sending = ref(false)
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
    durationMs.value = 0
    durationTimer = window.setInterval(() => {
      durationMs.value += 100
    }, 100)
    // Автоостановка — 2 минуты.
    maxTimer = window.setTimeout(() => {
      if (state.value === 'recording') stopRecording()
    }, 120_000)
  } catch {
    // Нет доступа к микрофону — просто закрываем.
    emit('cancel')
    dispose()
  }
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
  gap: 10px;
  background: #ffffff;
  border-radius: 12px;
  padding: 7px 12px;
}

.vr-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #e04545;
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
  color: #1c2733;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vr-timer {
  font-size: 13px;
  color: #8a98a3;
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
  background: #fdecec;
  color: #d64545;
}

.vr-btn.danger:hover {
  background: #f8dada;
}

.vr-btn.accent {
  background: #e3f2e5;
  color: #2ea25e;
}

.vr-btn.accent:hover {
  background: #d0ead5;
}

.vr-play {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: #2ea25e;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  flex-shrink: 0;
  padding-left: 2px;
}

.vr-play:hover {
  background: #39b56c;
}

.vr-hidden-audio {
  display: none;
}
</style>
