<template>
  <div
    class="round-video-msg"
    :class="{ playing: isPlaying, broken }"
    role="button"
    tabindex="0"
    :title="broken ? 'Видео недоступно' : 'Воспроизвести видеосообщение'"
    @click="togglePlay"
    @keydown.enter.prevent="togglePlay"
    @keydown.space.prevent="togglePlay"
  >
    <video
      ref="videoRef"
      class="rvm-video"
      :src="src"
      playsinline
      preload="metadata"
      :muted="muted"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @error="onError"
    ></video>

    <!-- Запись недоступна -->
    <div v-if="broken" class="rvm-error">
      <q-icon name="warning" size="18px" />
      <span>Видео недоступно</span>
    </div>

    <!-- Центральная кнопка play (когда не играет) -->
    <div v-else-if="!isPlaying" class="rvm-center">
      <span class="rvm-play">
        <q-icon name="play_arrow" size="30px" />
      </span>
    </div>

    <!-- Управление звуком (только во время воспроизведения) -->
    <button
      v-else
      class="rvm-chip rvm-sound"
      :title="muted ? 'Включить звук' : 'Выключить звук'"
      @click.stop="toggleMute"
    >
      <q-icon :name="muted ? 'volume_off' : 'volume_up'" size="18px" />
    </button>

    <!-- Развернуть на весь экран -->
    <button
      v-if="!broken"
      class="rvm-chip rvm-expand"
      :title="'Смотреть «' + name + '» на весь экран'"
      @click.stop="openPreview"
    >
      <q-icon name="fullscreen" size="18px" />
    </button>
  </div>

  <!-- Просмотр крупно (полноценный плеер с контролами) -->
  <Teleport to="body">
    <div v-if="previewOpen" class="rvm-modal" @mousedown.self="closePreview">
      <div class="rvm-modal-card">
        <div class="rvm-modal-head">
          <span class="rvm-modal-title">
            <q-icon name="videocam" size="18px" />
            {{ name }}
          </span>
          <button class="rvm-modal-close" title="Закрыть" @click="closePreview">
            <q-icon name="close" size="20px" />
          </button>
        </div>
        <video :src="src" class="rvm-modal-video" controls autoplay playsinline></video>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  src: string
  name: string
  size?: number | null
}>()

const videoRef = ref<HTMLVideoElement | null>(null)
const isPlaying = ref(false)
const muted = ref(false)
const broken = ref(false)
const previewOpen = ref(false)

const onPlay = () => {
  isPlaying.value = true
}

const onPause = () => {
  isPlaying.value = false
}

const onEnded = () => {
  isPlaying.value = false
  const video = videoRef.value
  if (video) video.currentTime = 0
}

const onError = () => {
  broken.value = true
  isPlaying.value = false
}

const togglePlay = async () => {
  if (broken.value || previewOpen.value) return
  const video = videoRef.value
  if (!video) return
  if (video.paused) {
    try {
      await video.play()
    } catch {
      broken.value = true
    }
  } else {
    video.pause()
  }
}

const toggleMute = () => {
  muted.value = !muted.value
}

const openPreview = () => {
  previewOpen.value = true
  // Останавливаем воспроизведение в кружке, чтобы не играло одновременно.
  const video = videoRef.value
  if (video && !video.paused) video.pause()
}

const closePreview = () => {
  previewOpen.value = false
}
</script>

<style scoped>
.round-video-msg {
  position: relative;
  width: min(300px, 66vw);
  max-width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  overflow: hidden;
  background: #000;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.round-video-msg:focus-visible {
  outline: 2px solid var(--ms-accent, #2ea25e);
  outline-offset: 2px;
}

.rvm-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #000;
}

/* Затемнение в центре для читаемой иконки play */
.rvm-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  pointer-events: none;
}

.rvm-play {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: var(--ms-accent, #2ea25e);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
}

.rvm-play i {
  font-size: 1.35rem;
  transform: translateX(2px);
}

.rvm-chip {
  position: absolute;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.9rem;
  opacity: 0;
  transition:
    opacity 0.12s,
    background 0.12s;
  z-index: 2;
}

.round-video-msg:hover .rvm-chip,
.round-video-msg:focus-within .rvm-chip,
.rvm-chip:focus-visible {
  opacity: 1;
}

.rvm-chip:hover {
  background: rgba(0, 0, 0, 0.78);
}

.rvm-sound {
  top: 8px;
  right: 8px;
}

.rvm-expand {
  bottom: 8px;
  right: 8px;
}

.rvm-expand i {
  font-size: 0.85rem;
}

.rvm-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  font-size: 12.5px;
  background: rgba(0, 0, 0, 0.5);
  cursor: default;
}

.rvm-error i {
  font-size: 1.4rem;
}

/* Модальный плеер */
.rvm-modal {
  position: fixed;
  inset: 0;
  z-index: 5100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 11, 15, 0.82);
  backdrop-filter: blur(3px);
  padding: 18px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.rvm-modal-card {
  width: min(860px, 100%);
  background: #10151c;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
}

.rvm-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  color: #e9eff4;
}

.rvm-modal-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rvm-modal-title i {
  color: var(--ms-accent, #2ea25e);
}

.rvm-modal-close {
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
  flex-shrink: 0;
}

.rvm-modal-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.rvm-modal-video {
  width: 100%;
  max-height: 82vh;
  background: #000;
  display: block;
}
</style>
