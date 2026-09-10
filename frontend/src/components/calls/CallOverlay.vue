<template>
  <Teleport to="body">
    <transition name="call-fade">
      <!-- Полноэкранный звонок -->
      <div
        v-if="callStore.status !== 'idle'"
        class="call-overlay"
        @mousedown.stop
        @pointerdown="callStore.resumeOutput()"
      >
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
          <!-- Видео собеседника (звук — Web Audio или фолбэк элемента) -->
          <video
            v-if="callStore.kind === 'video'"
            ref="remoteVideoEl"
            class="remote-video"
            autoplay
            playsinline
          ></video>
          <!-- Аудио-звонок: элемент для воспроизведения/фолбэка (mute задаётся в коде) -->
          <audio v-if="callStore.kind === 'audio'" ref="remoteAudioEl" autoplay playsinline></audio>

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
              <span v-if="callStore.peerScreenSharing" class="call-sharing">
                <q-icon name="screen_share" size="13px" aria-hidden="true" />
                Собеседник показывает экран
              </span>
              <span class="call-e2ee" title="Медиа защищено сквозным шифрованием (DTLS-SRTP)">
                <q-icon name="lock" size="11px" aria-hidden="true" />
                Сквозное шифрование
              </span>
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
                <span v-if="callStore.peerScreenSharing" class="call-sharing video">
                  <q-icon name="screen_share" size="12px" aria-hidden="true" />
                  Собеседник показывает экран
                </span>
                <span
                  class="call-e2ee video"
                  title="Медиа защищено сквозным шифрованием (DTLS-SRTP)"
                >
                  <q-icon name="lock" size="10px" aria-hidden="true" />
                  Сквозное шифрование
                </span>
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

            <!-- Элементы управления: в панели — только частое (микрофон, камера,
                 завершить). Остальное — в меню «ещё»: иначе на телефоне кнопки
                 не помещаются в одну строку. -->
            <div class="call-controls active-controls">
              <button
                class="ctl-btn"
                :class="{ off: !callStore.micOn }"
                title="Микрофон"
                @click="callStore.toggleMic()"
              >
                <q-icon name="mic" size="26px" />
              </button>
              <button
                v-if="callStore.kind === 'video' && !callStore.screenSharing"
                class="ctl-btn"
                :class="{ off: !callStore.videoOn }"
                title="Камера"
                @click="callStore.toggleCamera()"
              >
                <q-icon name="videocam" size="26px" />
              </button>
              <button
                class="ctl-btn"
                :class="{ 'screen-on': callStore.screenSharing, 'speaker-on': moreOpen }"
                :title="moreOpen ? 'Скрыть меню' : 'Ещё'"
                :aria-expanded="moreOpen"
                :aria-pressed="moreOpen"
                @click="toggleMore"
              >
                <q-icon :name="moreOpen ? 'close' : 'more_vert'" size="26px" />
              </button>
              <button class="ctl-btn danger big" title="Завершить" @click="callStore.endCall()">
                <q-icon name="call_end" size="28px" />
              </button>
            </div>

            <!-- Меню «ещё»: редкие во время звонка действия -->
            <div v-if="moreOpen" class="call-more" role="menu">
              <button class="more-row" role="menuitem" @click="onSpeakerRow">
                <q-icon :name="speakerOn ? 'volume_up' : 'volume_down'" size="20px" />
                <span>{{ speakerOn ? 'Обычный режим' : 'Громкая связь' }}</span>
                <q-icon v-if="speakerOn" name="check" size="16px" class="more-mark" />
              </button>
              <button
                v-if="canShareScreen || callStore.screenSharing"
                class="more-row"
                :class="{ on: callStore.screenSharing }"
                role="menuitem"
                @click="onScreenRow"
              >
                <q-icon
                  :name="callStore.screenSharing ? 'stop_screen_share' : 'screen_share'"
                  size="20px"
                />
                <span>{{
                  callStore.screenSharing ? 'Остановить показ экрана' : 'Показать экран'
                }}</span>
                <q-icon v-if="callStore.screenSharing" name="check" size="16px" class="more-mark" />
              </button>
              <button
                class="more-row"
                :class="{ on: settingsOpen }"
                role="menuitem"
                @click="onDevicesRow"
              >
                <q-icon name="tune" size="20px" />
                <span>Устройства звонка</span>
                <q-icon v-if="settingsOpen" name="check" size="16px" class="more-mark" />
              </button>
            </div>

            <!-- Настройки устройств звонка -->
            <div v-if="settingsOpen" class="call-settings">
              <label v-if="callStore.cameras.length" class="settings-row">
                <span class="settings-label">Камера</span>
                <select
                  class="settings-select"
                  :value="callStore.selectedCamera"
                  @change="onCameraChange($event)"
                >
                  <option
                    v-for="cam in callStore.cameras"
                    :key="cam.deviceId"
                    :value="cam.deviceId"
                  >
                    {{ cam.label || 'Камера' }}
                  </option>
                </select>
              </label>

              <label v-if="callStore.microphones.length" class="settings-row">
                <span class="settings-label">Микрофон</span>
                <select
                  class="settings-select"
                  :value="callStore.selectedMic"
                  @change="onMicChange($event)"
                >
                  <option
                    v-for="mic in callStore.microphones"
                    :key="mic.deviceId"
                    :value="mic.deviceId"
                  >
                    {{ mic.label || 'Микрофон' }}
                  </option>
                </select>
              </label>

              <label v-if="callStore.speakers.length && canSelectSpeaker" class="settings-row">
                <span class="settings-label">Звук</span>
                <select
                  class="settings-select"
                  :value="callStore.selectedSpeaker"
                  @change="onSpeakerChange($event)"
                >
                  <option
                    v-for="spk in callStore.speakers"
                    :key="spk.deviceId"
                    :value="spk.deviceId"
                  >
                    {{ spk.label || 'Динамик' }}
                  </option>
                </select>
              </label>

              <p
                v-if="!callStore.cameras.length && !callStore.microphones.length"
                class="settings-hint"
              >
                Список устройств появится после разрешения доступа к камере и микрофону.
              </p>
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { screenShareSupport, useCallStore } from '@/stores/call'
import { mediaUrl } from '@/services/chatService'
import { avatarStyle as userAvatarStyle, initials as userInitials } from '@/utils/user'

const callStore = useCallStore()

const remoteVideoEl = ref<HTMLVideoElement | null>(null)
const remoteAudioEl = ref<HTMLAudioElement | null>(null)
const localVideoEl = ref<HTMLVideoElement | null>(null)
/** Доступен ли в этом окружении захват экрана (иначе пункт меню скрыт). */
const canShareScreen = screenShareSupport() === 'ok'

const noticeVisible = ref(false)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let attachTimer: ReturnType<typeof setInterval> | undefined

// «Громкая связь»: по умолчанию тихо («к уху»), кнопкой — на максимум.
// Громкость задаём через Web Audio gain в call.ts — element.volume на
// телефонах игнорируется, поэтому без этого «тихий» режим не работал бы.
const EARP_VOLUME = 0.12
const speakerOn = ref(false)

// Панель выбора устройств (камера/микрофон/динамик) во время звонка.
const settingsOpen = ref(false)

// Меню «ещё»: редкие во время звонка действия (громкая связь, показ экрана,
// устройства). В панели они не помещаются на телефоне в одну строку.
const moreOpen = ref(false)

/** Открыть/закрыть меню «ещё»; панель устройств и меню разом не показываем. */
const toggleMore = () => {
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) settingsOpen.value = false
}

const onSpeakerRow = () => {
  toggleSpeaker()
  moreOpen.value = false
}

const onScreenRow = () => {
  void callStore.toggleScreenShare()
  moreOpen.value = false
}

const onDevicesRow = () => {
  settingsOpen.value = !settingsOpen.value
  moreOpen.value = false
}

/** Умеет ли браузер выводить звук на выбранное устройство (setSinkId). */
const canSelectSpeaker = computed(
  () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
)

const onCameraChange = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  void callStore.setCameraDevice(value)
}

const onMicChange = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  void callStore.setMicDevice(value)
}

const onSpeakerChange = (event: Event) => {
  callStore.setSpeakerDevice((event.target as HTMLSelectElement).value)
}

/** Направляет звук на выбранный динамик (Safari/iOS не поддерживают — молча пропускаем). */
const applySink = () => {
  if (!canSelectSpeaker.value || !callStore.selectedSpeaker) return
  const parent = remoteVideoEl.value ?? remoteAudioEl.value
  type SinkCapable = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }
  const el = parent as SinkCapable | null
  if (!el?.setSinkId) return
  void el.setSinkId(callStore.selectedSpeaker).catch(() => undefined)
}

const fallbackEl = (): HTMLMediaElement | null =>
  callStore.kind === 'video' ? remoteVideoEl.value : remoteAudioEl.value

const applySpeaker = () => {
  if (callStore.outputReady()) {
    // Web Audio работает — громкость честная (тихо/громко).
    callStore.setOutputVolume(speakerOn.value ? 1 : EARP_VOLUME)
  } else {
    // Web Audio не готов — звук идёт через элемент (громкость элемента на части
    // телефонов игнорируется, но по крайней мере звонок слышно).
    const el = fallbackEl()
    if (el) el.volume = speakerOn.value ? 1 : EARP_VOLUME
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

// Явно запускаем воспроизведение (на мобильных autoplay-атрибут не всегда
// стартует после назначения srcObject, из-за чего видео чёрное при живом звуке).
const ensurePlaying = (el: HTMLMediaElement | null) => {
  if (el && el.srcObject && el.paused) {
    void el.play().catch(() => undefined)
  }
}

let lastRemoteVideoTracks = 0

const attachStreams = () => {
  const remote = callStore.getRemoteStream()
  const isVideo = callStore.kind === 'video'

  // Пытаемся держать Web Audio запущенным; если он не готов — звук идёт
  // напрямую через элемент (фолбэк), чтобы звонок не был немым.
  callStore.resumeOutput()
  const viaWeb = callStore.outputReady()

  if (isVideo) {
    const remoteVideo = remoteVideoEl.value
    const videoTracks = remote ? remote.getVideoTracks().length : 0
    if (remoteVideo) {
      const needsBind =
        remoteVideo.srcObject !== remote ||
        // Видеотрек мог прийти позже аудио — пере-привязываем, чтобы «проснуться».
        (videoTracks > 0 &&
          videoTracks !== lastRemoteVideoTracks &&
          remoteVideo.srcObject === remote)
      if (needsBind) {
        remoteVideo.srcObject = null
        remoteVideo.srcObject = remote
      }
      // Web Audio играет звук → глушим элемент (только картинка); иначе — фолбэк.
      remoteVideo.muted = viaWeb
      ensurePlaying(remoteVideo)
    }
    lastRemoteVideoTracks = videoTracks
  }

  const audioEl = remoteAudioEl.value
  if (audioEl) {
    if (audioEl.srcObject !== remote) {
      audioEl.srcObject = remote
    }
    audioEl.muted = viaWeb
    ensurePlaying(audioEl)
  }

  const local = callStore.getLocalStream()
  if (localVideoEl.value && localVideoEl.value.srcObject !== local) {
    localVideoEl.value.srcObject = local
  }
  ensurePlaying(localVideoEl.value)
  applySpeaker()
  applySink()
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
      settingsOpen.value = false
      moreOpen.value = false
    }
  }
)

// Демонстрация экрана могла включиться из аудиозвонка (или наоборот завершиться) —
// перебрасываем потоки в правильные элементы без ожидания следующего тика.
watch(
  () => [callStore.kind, callStore.screenSharing, callStore.selectedSpeaker],
  () => {
    void nextTick(attachStreams)
  }
)

// Показ экрана могли остановить из плашки браузера, а не из меню — прячем меню,
// чтобы его подписи не расходились с состоянием звонка.
watch(
  () => callStore.screenSharing,
  () => {
    moreOpen.value = false
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

/* Плашка «сквозное шифрование» (WebRTC = DTLS-SRTP) */
.call-e2ee {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 11.5px;
  background: rgba(46, 162, 94, 0.18);
  border: 1px solid rgba(46, 162, 94, 0.4);
  border-radius: 999px;
  padding: 2px 9px;
  user-select: none;
}

.call-e2ee .q-icon {
  color: #58d68d;
  font-size: 1.05rem;
}

.call-e2ee.video {
  align-self: flex-start;
  margin-top: 3px;
  font-size: 10px;
  padding: 1px 7px;
}

/* Плашка «собеседник показывает экран» */
.call-sharing {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  color: #fff;
  font-size: 11.5px;
  background: rgba(58, 166, 224, 0.22);
  border: 1px solid rgba(58, 166, 224, 0.5);
  border-radius: 999px;
  padding: 2px 10px;
  user-select: none;
}

.call-sharing .q-icon {
  color: #6cc4f0;
  font-size: 1.05rem;
}

.call-sharing.video {
  align-self: flex-start;
  margin-top: 3px;
  font-size: 10px;
  padding: 1px 7px;
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

/* Кнопка демонстрации экрана в активном состоянии */
.ctl-btn.screen-on {
  background: #3aa6e0;
}

/* ---------- Меню «ещё» (редкие действия во время звонка) ---------- */
.call-more {
  position: absolute;
  bottom: 108px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: min(300px, calc(100vw - 40px));
  padding: 8px;
  background: rgba(16, 22, 30, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}

.more-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;
}

.more-row:hover,
.more-row.on {
  background: rgba(255, 255, 255, 0.12);
}

.more-row .more-mark {
  margin-left: auto;
  opacity: 0.85;
}

/* ---------- Панель устройств звонка ---------- */
.call-settings {
  position: absolute;
  bottom: 108px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(360px, calc(100vw - 32px));
  padding: 12px 14px;
  background: rgba(16, 22, 30, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}

.settings-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: rgba(255, 255, 255, 0.6);
}

.settings-select {
  width: 100%;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 13.5px;
  font-family: inherit;
}

.settings-select option {
  color: #10161e;
}

.settings-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

@media (max-width: 420px) {
  .active-controls {
    gap: 11px;
  }

  .ctl-btn {
    width: 50px;
    height: 50px;
    font-size: 1.25rem;
  }

  .ctl-btn.big {
    width: 58px;
    height: 58px;
  }

  .call-settings {
    bottom: 96px;
  }

  .call-more {
    bottom: 96px;
  }
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
