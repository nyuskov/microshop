<template>
  <div class="call-grid" :class="`call-grid-${columns}`" data-test="call-grid">
    <div
      v-for="participant in callStore.participants"
      :key="participant.id"
      class="grid-tile"
      :class="{ 'no-video': !showsVideo(participant.id) }"
    >
      <video
        v-if="showsVideo(participant.id)"
        :ref="(el) => setVideoEl(participant.id, el)"
        class="grid-video"
        autoplay
        playsinline
      ></video>
      <div v-else class="grid-avatar">
        <q-icon
          :name="icon(ringing(participant.id) ? 'call' : 'person')"
          size="34px"
          aria-hidden="true"
        />
        <span class="grid-avatar-name">
          {{ ringing(participant.id) ? 'Звоним…' : participant.name }}
        </span>
      </div>
      <!-- Не поднял трубку — его можно сбросить, не дожидаясь, пока он ответит
           (разговор с остальными уже идёт). -->
      <button
        v-if="ringing(participant.id)"
        class="grid-drop"
        type="button"
        :title="`Сбросить вызов: ${participant.name}`"
        :aria-label="`Сбросить вызов: ${participant.name}`"
        @click.stop="emit('drop', participant.id)"
      >
        <q-icon :name="icon('call_end')" size="18px" />
      </button>
      <div class="grid-plate">
        <q-icon
          :name="icon(participant.micOn ? 'mic' : 'mic_off')"
          size="15px"
          class="grid-mic"
          :class="{ off: !participant.micOn }"
          :title="participant.micOn ? 'Микрофон включён' : 'Микрофон выключен'"
        />
        <span class="grid-name">{{ participant.name }}</span>
        <q-icon
          v-if="participant.screenSharing"
          :name="icon('screen_share')"
          size="15px"
          title="Показывает экран"
        />
      </div>
    </div>
    <div class="grid-tile self">
      <video
        v-if="localVideo"
        :ref="(el) => setLocalVideoEl(el)"
        class="grid-video"
        autoplay
        playsinline
        muted
      ></video>
      <div v-else class="grid-avatar">
        <q-icon :name="icon('person')" size="34px" aria-hidden="true" />
        <span class="grid-avatar-name">Вы</span>
      </div>
      <div class="grid-plate">
        <q-icon
          :name="icon(callStore.micOn ? 'mic' : 'mic_off')"
          size="15px"
          class="grid-mic"
          :class="{ off: !callStore.micOn }"
        />
        <span class="grid-name">Вы</span>
        <q-icon
          v-if="callStore.screenSharing"
          :name="icon('screen_share')"
          size="15px"
          title="Показываете экран"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { useCallStore } from '@/stores/call'
import { icon } from '@/utils/icons'

/**
 * Сетка участников группового звонка («mesh»).
 *
 * У каждого участника своё соединение и свой поток, поэтому и плитка своя: раньше
 * экран звонка умел показывать ровно одного собеседника. Плитки раскладываются
 * колонками по числу участников (с собой — от 2 до 4), видео подключается к
 * элементу вручную: `srcObject` нельзя привязать атрибутом.
 */
const callStore = useCallStore()

/** Сброс участника, который так и не подключился (обрабатывает оверлей). */
const emit = defineEmits<{ (e: 'drop', peerId: number): void }>()

/** Элементы видео по участникам: поток надо назначать вручную (`srcObject`). */
const videoEls = new Map<number, HTMLVideoElement>()
const localVideoEl = ref<HTMLVideoElement | null>(null)

/** Сколько колонок в сетке: у 2–4 участников это 1, 2 и 2. */
const columns = computed<number>(() => {
  const total = callStore.participants.length + 1
  return total <= 1 ? 1 : total === 2 ? 1 : 2
})

/** Собеседник ещё не подключился: у него сейчас идёт вызов. */
const ringing = (peerId: number): boolean => {
  const participant = callStore.participants.find((item) => item.id === peerId)
  if (!participant) return false
  return !participant.connected
}

/** Идёт ли от участника видео (камера или показ экрана). */
const showsVideo = (peerId: number): boolean => {
  const participant = callStore.participants.find((item) => item.id === peerId)
  if (!participant) return false
  return participant.videoOn && callStore.remoteStreamOf(peerId) !== null
}

const localVideo = computed<boolean>(
  () => callStore.screenSharing || (callStore.videoOn && callStore.kind === 'video')
)

const localStream = ref<MediaStream | null>(null)

const setVideoEl = (peerId: number, el: unknown): void => {
  if (el instanceof HTMLVideoElement) videoEls.set(peerId, el)
  else videoEls.delete(peerId)
}

const setLocalVideoEl = (el: unknown): void => {
  localVideoEl.value = el instanceof HTMLVideoElement ? el : null
}

/**
 * Раздаёт потоки элементам: у каждого участника свой, поэтому переписываем все
 * плитки при любом изменении состава или состояния микрофона/камеры.
 */
const attachStreams = (): void => {
  for (const participant of callStore.participants) {
    const el = videoEls.get(participant.id)
    const stream = callStore.remoteStreamOf(participant.id)
    if (el && stream && el.srcObject !== stream) el.srcObject = stream
  }
  const local = callStore.getLocalStream()
  localStream.value = local
  const el = localVideoEl.value
  if (el && local && el.srcObject !== local) el.srcObject = local
}

watch(
  () => [
    callStore.participants.length,
    callStore.participants.map((item) => `${item.id}:${item.videoOn ? 1 : 0}`).join(','),
    callStore.videoOn,
    callStore.screenSharing
  ],
  () => {
    void nextTick(attachStreams)
  },
  { immediate: true }
)

/** Треки могли приехать до появления плитки — дотягиваем по таймеру. */
const poll = window.setInterval(attachStreams, 1000)
onBeforeUnmount(() => window.clearInterval(poll))
</script>

<style scoped>
.call-grid {
  display: grid;
  gap: 8px;
  width: 100%;
  height: 100%;
  align-content: center;
  justify-items: center;
}

.call-grid-1 {
  grid-template-columns: minmax(0, 1fr);
}

.call-grid-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid-tile {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  max-height: 100%;
  overflow: hidden;
  border-radius: 12px;
  background: var(--ms-call-surface);
  display: flex;
  align-items: center;
  justify-content: center;
}

.grid-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--ms-call-bg);
}

.grid-avatar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--ms-muted);
}

.grid-avatar-name {
  font-size: 0.85rem;
}

.grid-drop {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: var(--ms-call-danger);
  color: var(--ms-call-fg);
  cursor: pointer;
}

.grid-drop:hover {
  filter: brightness(1.1);
}

.grid-plate {
  position: absolute;
  left: 8px;
  bottom: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--ms-scrim-soft);
  color: var(--ms-call-fg);
  font-size: 0.8rem;
}

.grid-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-mic.off {
  color: var(--ms-call-danger);
}
</style>
