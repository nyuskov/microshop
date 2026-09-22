<template>
  <!-- Причину недоступности кружок показывает своим чипом на самом видео, поэтому
       в строку её не дублируем: там остаётся только кнопка расшифровки. -->
  <MediaMessageShell class="rvm-shell" :message-id="messageId" :src="src">
    <template #player>
      <div
        class="round-video-msg"
        :class="{ playing: isPlaying, broken }"
        :role="broken ? undefined : 'button'"
        :tabindex="broken ? undefined : 0"
        :title="broken ? t('Видео недоступно') : t('Воспроизвести видеосообщение')"
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
          <q-icon :name="icon('warning')" size="18px" />
          <span>{{ t('Видео недоступно') }}</span>
        </div>

        <!-- Центральная кнопка play (когда не играет) -->
        <div v-else-if="!isPlaying" class="rvm-center">
          <span class="rvm-play">
            <q-icon :name="icon('play_arrow')" size="30px" />
          </span>
        </div>

        <!-- Скорость воспроизведения (круговая: 1× → 1.5× → 2×), общая для всех
         голосовых и видеосообщений -->
        <button
          v-else
          class="rvm-chip rvm-speed"
          :title="`Скорость ${speedLabel(playbackSpeed)} — нажмите, чтобы изменить`"
          @click.stop="onCycleSpeed"
        >
          <span class="rvm-speed-label">{{ speedLabel(playbackSpeed) }}</span>
        </button>

        <!-- Управление звуком (только во время воспроизведения) -->
        <button
          v-if="isPlaying"
          class="rvm-chip rvm-sound"
          :title="muted ? t('Включить звук') : t('Выключить звук')"
          @click.stop="toggleMute"
        >
          <q-icon :name="icon(muted ? 'volume_off' : 'volume_up')" size="18px" />
        </button>

        <!-- Развернуть на весь экран -->
        <button
          v-if="!broken"
          class="rvm-chip rvm-expand"
          :title="t('Смотреть «{name}» на весь экран', { name })"
          @click.stop="openPreview"
        >
          <q-icon :name="icon('fullscreen')" size="18px" />
        </button>

        <!-- Плавающее окно: видео продолжает играть поверх других приложений.
         У недоступной записи кнопка бессмысленна — играть нечего. -->
        <button
          v-if="canPictureInPicture && !broken"
          class="rvm-chip rvm-pip"
          :title="t('Смотреть в плавающем окне')"
          @click.stop="openPictureInPicture"
        >
          <q-icon :name="icon('picture_in_picture')" size="18px" />
        </button>
      </div>
    </template>
  </MediaMessageShell>

  <!-- Просмотр крупно (полноценный плеер с контролами) -->
  <Teleport to="body">
    <div v-if="previewOpen" class="rvm-modal" @mousedown.self="closePreview">
      <div class="rvm-modal-card">
        <div class="rvm-modal-head">
          <span class="rvm-modal-title">
            <q-icon :name="icon('video_message')" size="18px" />
            {{ name }}
          </span>
          <button class="rvm-modal-close" :title="t('Закрыть')" @click="closePreview">
            <q-icon :name="icon('close')" size="20px" />
          </button>
        </div>
        <video :src="src" class="rvm-modal-video" controls autoplay playsinline></video>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, onMounted, ref, watch } from 'vue'
import { cyclePlaybackSpeed, playbackSpeed, speedLabel } from '@/utils/playbackSpeed'
import MediaMessageShell from '@/components/media/MediaMessageShell.vue'
import { t } from '@/i18n'

defineProps<{
  /** Id сообщения: нужен расшифровке, чтобы помнить текст при перерисовке ленты. */
  messageId: number
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

/** Скорость задаётся на самом элементе `<video>`: держим её в актуальном виде. */
const applySpeed = () => {
  const video = videoRef.value
  if (video) video.playbackRate = playbackSpeed.value
}

onMounted(applySpeed)
watch(playbackSpeed, applySpeed)

const onCycleSpeed = () => {
  cyclePlaybackSpeed()
  applySpeed()
}

const openPreview = () => {
  previewOpen.value = true
  // Останавливаем воспроизведение в кружке, чтобы не играло одновременно.
  const video = videoRef.value
  if (video && !video.paused) video.pause()
}

/** Доступно ли «окно поверх других» (PiP) для видео. */
const canPictureInPicture = computed(
  () => typeof document !== 'undefined' && document.pictureInPictureEnabled === true
)

/** Открыть видео в плавающем окне — можно листать чат и уходить из приложения. */
const openPictureInPicture = async () => {
  const video = videoRef.value
  if (!video || typeof video.requestPictureInPicture !== 'function') return
  try {
    if (video.paused) await video.play().catch(() => undefined)
    await video.requestPictureInPicture()
  } catch (error) {
    console.error(t('Не удалось открыть плавающее окно:'), error)
  }
}

const closePreview = () => {
  previewOpen.value = false
}
</script>

<style scoped>
/* Оболочка сообщения — шириной с сам круг: иначе длинный текст расшифровки
   растягивал строку на всю ленту и уезжал далеко влево (владелец: «текст слишком
   длинный и далеко уходит влево»). Теперь и текст, и кнопки идут столбцом точно
   под кругом. */
.rvm-shell {
  max-width: min(300px, 66vw);
}
/* Круг и расшифровка под ним: колонка по левому краю, иначе круг «поедет». */

/* Текст расшифровки у кружка не переопределяем: он должен выглядеть и вести себя
   ровно как у голосового (владелец: «как в аудио сделай») — та же полоса слева,
   тот же порядок кнопок. Отличается только сама кнопка: у кружка нет строки с
   названием, поэтому она стоит отдельной строкой по правому краю.
 */
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

/* Скорость: пилюля слева сверху, чтобы не перекрывать звук (справа сверху)
   и разворот на весь экран (справа снизу). */
.rvm-speed {
  top: 8px;
  left: 8px;
  width: auto;
  min-width: 34px;
  height: 22px;
  border-radius: 11px;
  padding: 0 6px;
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.rvm-speed-label {
  line-height: 1;
}

.rvm-expand {
  bottom: 8px;
  right: 8px;
}

.rvm-expand i {
  font-size: 0.85rem;
}

/* Недоступная запись: круг 300 px из чёрного фона — это огромное чёрное пятно
   ради строки «Видео недоступно», да ещё и не по теме (в светлой теме оно тоже
   чёрное). Рисуем компактную плашку в цветах темы, как у недоступного
   вложения: видео в ней скрыто, содержимое — иконка и текст. */
.round-video-msg.broken {
  width: auto;
  height: auto;
  aspect-ratio: auto;
  border-radius: var(--ms-radius-sm);
  background: var(--ms-surface-2);
  box-shadow: none;
  display: inline-flex;
  align-items: center;
  cursor: default;
  padding: 0;
}

.round-video-msg.broken .rvm-video {
  display: none;
}

.rvm-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  color: var(--ms-muted);
  font-size: var(--ms-fs-xs);
  cursor: default;
}

.rvm-error i {
  font-size: 1rem;
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
  font-family: var(--ms-font);
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
