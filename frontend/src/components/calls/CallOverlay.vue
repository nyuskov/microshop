<template>
  <Teleport to="body">
    <transition name="call-fade">
      <!-- Полноэкранный звонок -->
      <div v-if="callStore.status !== 'idle'" class="call-overlay" @mousedown.stop>
        <template v-if="callStore.status === 'incoming'">
          <div class="call-card">
            <span class="call-avatar" :style="avatarStyle(displayName)">
              <img
                v-if="avatarUrl && !avatarImgFailed"
                :src="avatarUrl"
                class="avatar-img"
                alt=""
                @error="avatarImgFailed = true"
              />
              <template v-else>{{ displayNameInitials }}</template>
            </span>
            <h2 class="call-name">{{ displayName }}</h2>
            <p class="call-subtitle">
              Входящий {{ callStore.kind === 'video' ? 'видеозвонок' : 'звонок' }}
            </p>
            <div class="call-controls incoming-controls">
              <button class="ctl-btn danger big" title="Отклонить" @click="callStore.declineCall()">
                <q-icon name="call_end" size="28px" />
              </button>
              <button class="ctl-btn accept big" title="Ответить" @click="callStore.acceptCall()">
                <q-icon :name="callStore.kind === 'video' ? 'videocam' : 'call'" size="28px" />
              </button>
            </div>
          </div>
        </template>

        <template v-else-if="callStore.status === 'outgoing'">
          <div class="call-card">
            <span class="call-avatar" :style="avatarStyle(displayName)">
              <img
                v-if="avatarUrl && !avatarImgFailed"
                :src="avatarUrl"
                class="avatar-img"
                alt=""
                @error="avatarImgFailed = true"
              />
              <template v-else>{{ displayNameInitials }}</template>
            </span>
            <h2 class="call-name">{{ displayName }}</h2>
            <p class="call-subtitle">Звоним…</p>
            <div class="call-controls incoming-controls">
              <button class="ctl-btn danger big" title="Отменить" @click="callStore.cancelCall()">
                <q-icon name="call_end" size="28px" />
              </button>
            </div>
          </div>
        </template>

        <template v-else-if="callStore.status === 'active'">
          <!-- Видео собеседника -->
          <video
            v-if="callStore.kind === 'video'"
            ref="remoteVideoEl"
            class="remote-video"
            autoplay
            playsinline
          ></video>
          <audio ref="remoteAudioEl" autoplay></audio>

          <div class="active-ui" :class="{ audio: callStore.kind === 'audio' }">
            <!-- Аудио-режим: аватар поверх фона -->
            <template v-if="callStore.kind === 'audio'">
              <span class="call-avatar huge" :style="avatarStyle(displayName)">
                <img
                  v-if="avatarUrl && !avatarImgFailed"
                  :src="avatarUrl"
                  class="avatar-img"
                  alt=""
                  @error="avatarImgFailed = true"
                />
                <template v-else>{{ displayNameInitials }}</template>
              </span>
              <h2 class="call-name audio-name">{{ displayName }}</h2>
              <p class="call-subtitle audio-sub">
                Голосовой звонок · {{ callStore.formattedTime }}
              </p>
            </template>

            <!-- Видео-режим: HUD сверху -->
            <div v-else class="video-hud">
              <span class="hud-avatar" :style="avatarStyle(displayName)">
                <img
                  v-if="avatarUrl && !avatarImgFailed"
                  :src="avatarUrl"
                  class="avatar-img"
                  alt=""
                  @error="avatarImgFailed = true"
                />
                <template v-else>{{ displayNameInitials }}</template>
              </span>
              <div class="hud-info">
                <div class="hud-name">{{ displayName }}</div>
                <div class="hud-time">{{ callStore.formattedTime }}</div>
              </div>
            </div>

            <!-- Локальное превью (видео) -->
            <video
              v-if="callStore.kind === 'video'"
              ref="localVideoEl"
              class="local-video"
              autoplay
              playsinline
              muted
            ></video>

            <!-- Элементы управления -->
            <div class="call-controls active-controls">
              <button
                class="ctl-btn"
                :class="{ 'speaker-on': speakerOn }"
                :title="speakerOn ? 'Обычный режим' : 'Громкая связь'"
                :aria-pressed="speakerOn"
                @click="toggleSpeaker"
              >
                <q-icon :name="speakerOn ? 'volume_up' : 'volume_down'" size="26px" />
              </button>
              <button
                class="ctl-btn"
                :class="{ off: !callStore.micOn }"
                title="Микрофон"
                @click="callStore.toggleMic()"
              >
                <q-icon name="mic" size="26px" />
              </button>
              <button
                v-if="callStore.kind === 'video'"
                class="ctl-btn"
                :class="{ off: !callStore.videoOn }"
                title="Камера"
                @click="callStore.toggleCamera()"
              >
                <q-icon name="videocam" size="26px" />
              </button>
              <button class="ctl-btn danger big" title="Завершить" @click="callStore.endCall()">
                <q-icon name="call_end" size="28px" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </transition>

    <!-- Тост-уведомление о завершении/ошибке -->
    <transition name="call-fade">
      <div v-if="noticeVisible" class="call-notice" @click="hideNotice">
        {{ callStore.notice }}
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCallStore } from '@/stores/call'
import { mediaUrl } from '@/services/chatService'
import { avatarStyle as userAvatarStyle, initials as userInitials } from '@/utils/user'

const callStore = useCallStore()

const remoteVideoEl = ref<HTMLVideoElement | null>(null)
const remoteAudioEl = ref<HTMLAudioElement | null>(null)
const localVideoEl = ref<HTMLVideoElement | null>(null)
const noticeVisible = ref(false)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let attachTimer: ReturnType<typeof setInterval> | undefined

// «Громкая связь»: по умолчанию обычная громкость, кнопкой — на максимум.
const speakerOn = ref(false)

const applySpeaker = () => {
  if (remoteAudioEl.value) {
    remoteAudioEl.value.volume = speakerOn.value ? 1 : 0.55
  }
}

const toggleSpeaker = () => {
  speakerOn.value = !speakerOn.value
  applySpeaker()
}

const avatarUrl = computed<string | undefined>(() => {
  const path = callStore.peerAvatar
  return path ? mediaUrl(path) : undefined
})

const displayName = computed<string>(() => {
  const name = callStore.peerName.trim()
  return name ? name : `Пользователь ${callStore.peerId ?? ''}`.trim()
})

const displayNameInitials = computed<string>(() => userInitials(displayName.value))

const avatarStyle = (name: string): Record<string, string> => userAvatarStyle(name)

// Если аватар не загрузился — показываем инициалы на градиенте вместо «битой»
// картинки (которая на некоторых устройствах рисуется чёрным квадратом).
const avatarImgFailed = ref(false)
watch(avatarUrl, () => {
  avatarImgFailed.value = false
})

const attachStreams = () => {
  const remote = callStore.getRemoteStream()
  if (remoteAudioEl.value && remoteAudioEl.value.srcObject !== remote) {
    remoteAudioEl.value.srcObject = remote
  }
  if (remoteVideoEl.value && remoteVideoEl.value.srcObject !== remote) {
    remoteVideoEl.value.srcObject = remote
  }
  const local = callStore.getLocalStream()
  if (localVideoEl.value && localVideoEl.value.srcObject !== local) {
    localVideoEl.value.srcObject = local
  }
  applySpeaker()
}

watch(
  () => callStore.status,
  (status) => {
    if (status === 'active') {
      if (attachTimer !== undefined) window.clearInterval(attachTimer)
      attachTimer = window.setInterval(attachStreams, 350)
      window.setTimeout(attachStreams, 100)
    } else if (attachTimer !== undefined) {
      window.clearInterval(attachTimer)
      attachTimer = undefined
      speakerOn.value = false
    }
  }
)

watch(
  () => callStore.notice,
  (notice) => {
    if (!notice) return
    noticeVisible.value = true
    if (noticeTimer !== undefined) window.clearTimeout(noticeTimer)
    noticeTimer = window.setTimeout(hideNotice, 3500)
  }
)

const hideNotice = () => {
  noticeVisible.value = false
  if (noticeTimer !== undefined) {
    window.clearTimeout(noticeTimer)
    noticeTimer = undefined
  }
  callStore.resetNotice()
}

onBeforeUnmount(() => {
  if (attachTimer !== undefined) window.clearInterval(attachTimer)
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer)
})
</script>

<style scoped>
.call-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(1200px 700px at 50% 20%, #243143, #10161e 70%);
  color: #fff;
  font-family: var(--ms-font);
  user-select: none;
  overflow: hidden;
}

.call-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px;
}

.call-avatar {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 2.6rem;
  color: #fff;
  overflow: hidden;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.35);
  margin-bottom: 12px;
  animation: avatar-pulse 1.6s ease-in-out infinite;
}

.call-avatar.huge {
  width: 180px;
  height: 180px;
  font-size: 3.8rem;
  animation: none;
}

@keyframes avatar-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(80, 200, 120, 0.35);
  }
  50% {
    box-shadow: 0 0 0 22px rgba(80, 200, 120, 0);
  }
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.call-name {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  text-align: center;
}

.call-name.audio-name {
  font-size: 24px;
}

.call-subtitle {
  margin: 0 0 18px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 14px;
}

.call-subtitle.audio-sub {
  margin-bottom: 26px;
}

/* ---------- Видеорежим ---------- */
.remote-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}

.active-ui {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}

.active-ui.audio {
  position: static;
}

.video-hud {
  position: absolute;
  top: 20px;
  left: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 16px;
  padding: 10px 16px;
  backdrop-filter: blur(6px);
}

.hud-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  flex-shrink: 0;
}

.hud-info {
  display: flex;
  flex-direction: column;
}

.hud-name {
  font-size: 15px;
  font-weight: 600;
}

.hud-time {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.75);
}

.local-video {
  position: absolute;
  right: 18px;
  bottom: 110px;
  width: 180px;
  max-width: 32vw;
  border-radius: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  background: #111;
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  transform: scaleX(-1);
  z-index: 5;
}

.ctl-btn.speaker-on {
  color: var(--ms-accent, #2ea25e);
}

/* ---------- Управление ---------- */
.call-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
}

.incoming-controls {
  gap: 40px;
  margin-top: 14px;
}

.active-controls {
  position: absolute;
  bottom: 34px;
  left: 0;
  right: 0;
  gap: 20px;
  z-index: 6;
}

.ctl-btn {
  position: relative;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 1.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    transform 0.12s,
    background 0.12s;
}

.ctl-btn:hover {
  transform: scale(1.07);
  background: rgba(255, 255, 255, 0.3);
}

.ctl-btn.accept {
  background: var(--ms-accent, #2ea25e);
}

.ctl-btn.accept:hover {
  background: var(--ms-accent-strong, #26884a);
}

.ctl-btn.danger {
  background: #e04545;
}

.ctl-btn.danger:hover {
  background: #ee5555;
}

.ctl-btn.big {
  width: 66px;
  height: 66px;
  font-size: 1.6rem;
}

/* Косой штрих на «выключенных» кнопках */
.ctl-btn.off::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 8%;
  width: 3px;
  height: 84%;
  background: #fff;
  border-radius: 2px;
  transform: translateX(-50%) rotate(-45deg);
}

.ctl-btn.danger.off::after {
  background: #fff;
}

/* ---------- Тост ---------- */
.call-notice {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4100;
  background: rgba(20, 26, 33, 0.92);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.14);
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}

.call-fade-enter-active,
.call-fade-leave-active {
  transition: opacity 0.22s;
}

.call-fade-enter-from,
.call-fade-leave-to {
  opacity: 0;
}
</style>
