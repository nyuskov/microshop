<template>
  <Teleport to="body">
    <div class="video-rec-modal" @mousedown.self="close">
      <div class="vrm-card">
        <div class="vrm-head">
          <span>Видеосообщение (кружок)</span>
          <button class="vrm-close" title="Закрыть" @click="close">
            <q-icon name="close" size="20px" />
          </button>
        </div>

        <div v-if="error" class="vrm-error">{{ error }}</div>

        <div class="vrm-stage">
          <video
            v-show="phase !== 'preview'"
            ref="liveVideoRef"
            class="vrm-video"
            :class="{ mirrored: phase !== 'preview' }"
            autoplay
            muted
            playsinline
          ></video>
          <video
            v-show="phase === 'preview'"
            ref="previewVideoRef"
            class="vrm-video"
            controls
            playsinline
          ></video>

          <div v-if="phase === 'recording'" class="vrm-rec-badge">
            <span class="vrm-dot"></span>
            Запись {{ formatClock(durationMs / 1000) }}
          </div>
          <div v-else-if="phase === 'live' && !error" class="vrm-hint">
            Нажмите «Запись», чтобы начать
          </div>
        </div>

        <div class="vrm-actions">
          <template v-if="phase === 'live' || phase === 'recording'">
            <button class="vrm-btn danger-text" @click="close">
              <q-icon name="close" size="18px" /> Отмена
            </button>
            <button
              v-if="phase === 'live'"
              class="vrm-btn record"
              :disabled="!streamReady"
              @click="start"
            >
              <q-icon name="fiber_manual_record" size="18px" /> Запись
            </button>
            <button v-else class="vrm-btn record stop" @click="stop">
              <q-icon name="stop" size="18px" /> Стоп
            </button>
          </template>

          <template v-else>
            <button class="vrm-btn" @click="retake">
              <q-icon name="replay" size="18px" /> Перезаписать
            </button>
            <button class="vrm-btn accent" :disabled="sending" @click="send">
              <q-icon name="send" size="17px" /> Отправить
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { formatClock, pickMimeType, stopMediaStream, type RecordedMedia } from '@/services/recorder'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'send', payload: RecordedMedia): void
}>()

const phase = ref<'live' | 'recording' | 'preview'>('live')
const durationMs = ref(0)
const error = ref('')
const sending = ref(false)
const streamReady = ref(false)
const liveVideoRef = ref<HTMLVideoElement | null>(null)
const previewVideoRef = ref<HTMLVideoElement | null>(null)

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

const openCamera = async (): Promise<boolean> => {
  try {
    stopMediaStream(mediaStream)
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      // Квадратная съёмка — видеосообщение показывается «кружком».
      video: { width: { ideal: 720 }, height: { ideal: 720 }, aspectRatio: 1, facingMode: 'user' }
    })
    streamReady.value = true
    await nextTick()
    if (liveVideoRef.value) {
      liveVideoRef.value.srcObject = mediaStream
    }
    return true
  } catch {
    error.value = 'Не удалось получить доступ к камере и микрофону.'
    streamReady.value = false
    return false
  }
}

const start = async () => {
  if (phase.value !== 'live') return
  if (!mediaStream) {
    const ok = await openCamera()
    if (!ok) return
  }
  const mime = pickMimeType('video')
  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(mediaStream as MediaStream, { mimeType: mime })
  } catch {
    rec = new MediaRecorder(mediaStream as MediaStream)
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
  phase.value = 'recording'
  durationMs.value = 0
  durationTimer = window.setInterval(() => {
    durationMs.value += 100
  }, 100)
  // Автоостановка — 60 секунд.
  maxTimer = window.setTimeout(() => {
    if (phase.value === 'recording') stop()
  }, 60_000)
}

const finalize = () => {
  if (!recorder) return
  blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
  clearTimers()
  stopMediaStream(mediaStream)
  mediaStream = null
  streamReady.value = false
  phase.value = 'preview'
  previewUrl = URL.createObjectURL(blob)
  void nextTick(() => {
    if (previewVideoRef.value && previewUrl) {
      previewVideoRef.value.src = previewUrl
    }
  })
}

const stop = () => {
  if (phase.value !== 'recording' || !recorder) return
  if (recorder.state === 'recording') {
    recorder.stop()
  }
}

const retake = () => {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl)
    previewUrl = null
  }
  blob = null
  phase.value = 'live'
  error.value = ''
  void openCamera()
}

const send = () => {
  if (!blob || sending.value) return
  sending.value = true
  const payload: RecordedMedia = { blob, mime: blob.type, durationMs: durationMs.value }
  const url = previewUrl
  clearTimers()
  disposed = true
  emit('send', payload)
  if (url) URL.revokeObjectURL(url)
}

const close = () => {
  dispose()
  emit('close')
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

onBeforeUnmount(() => {
  dispose()
})

void openCamera()
</script>

<style scoped>
.video-rec-modal {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 14, 18, 0.72);
  backdrop-filter: blur(3px);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  padding: 18px;
}

.vrm-card {
  width: min(640px, 100%);
  background: #171e26;
  color: #eef2f6;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
}

.vrm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-size: 15px;
  font-weight: 600;
}

.vrm-close {
  background: none;
  border: none;
  color: #9fb0bd;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.vrm-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.vrm-error {
  margin: 0 16px 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(224, 69, 69, 0.16);
  color: #ffb3b3;
  font-size: 13.5px;
}

.vrm-stage {
  position: relative;
  width: min(420px, 100%);
  margin: 0 auto;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  overflow: hidden;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vrm-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}

.vrm-video.mirrored {
  transform: scaleX(-1);
}

.vrm-rec-badge {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.vrm-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ff5252;
  animation: vrm-blink 1s ease-in-out infinite;
}

@keyframes vrm-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.vrm-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12.5px;
  white-space: nowrap;
}

.vrm-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 14px 16px;
}

.vrm-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 22px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.1);
  color: #eef2f6;
}

.vrm-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.vrm-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.vrm-btn.record {
  background: #e04545;
  color: #fff;
  min-width: 130px;
  justify-content: center;
}

.vrm-btn.record:hover {
  background: #ee5555;
}

.vrm-btn.record.stop {
  background: #fff;
  color: #171e26;
}

.vrm-btn.accent {
  background: #2ea25e;
  color: #fff;
}

.vrm-btn.accent:hover {
  background: #39b56c;
}

.vrm-btn.danger-text {
  color: #ffb3b3;
}
</style>
