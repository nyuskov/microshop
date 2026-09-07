<template>
  <div class="chat-header">
    <button class="icon-btn back-btn" title="Контакты" @click="emit('open-contacts')">
      <i class="pi pi-arrow-left"></i>
    </button>
    <span class="avatar chat-avatar" :style="avatarStyle(title)">
      <img v-if="peerAvatarUrl" :src="peerAvatarUrl" class="avatar-img" alt="" />
      <template v-else>{{ initials(title) }}</template>
    </span>
    <div class="chat-header-info">
      <div class="chat-title-row">
        <div class="chat-title">{{ title }}</div>
        <span v-if="statusPill" class="chat-status-pill">{{ statusPill }}</span>
      </div>
      <div class="chat-subtitle">{{ subtitle }}</div>
    </div>
    <div class="chat-header-actions">
      <span v-if="showCallButton" class="call-group" @click.stop>
        <button
          class="icon-btn call-btn"
          :class="{ holding: callHolding }"
          :title="callLabel(callKind) + ' — нажмите для звонка, удерживайте 0,5 с для смены типа'"
          @click="onCallClick"
          @pointerdown="onCallDown"
          @pointerup="onCallUp"
          @pointerleave="onCallUp"
          @pointercancel="onCallCancel"
          @contextmenu.prevent
        >
          <i :class="callKind === 'video' ? 'pi pi-video' : 'pi pi-phone'"></i>
        </button>
      </span>
      <button class="icon-btn" title="Поиск по сообщениям" @click="emit('toggle-search')">
        <i class="pi pi-search"></i>
      </button>
      <button class="icon-btn" title="Профиль" @click="emit('open-profile')">
        <span class="avatar mini" :style="avatarStyle(selfName)">
          <img v-if="selfAvatarUrl" :src="selfAvatarUrl" class="avatar-img" alt="" />
          <template v-else>{{ selfInitial }}</template>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Chat } from '@/types'
import { avatarStyle, avatarUrlOf, chatPeer, chatPeerTitle, initials } from '@/utils/user'
import { useCallButton } from '@/composables/useCallButton'

const props = defineProps<{
  chat: Chat
  currentUserId: number | null
  /** Подпись под именем (присутствие / «печатает…») — вычисляется родителем. */
  subtitle: string
  /** Ручной текст-статус собеседника (пилюля рядом с именем). */
  statusPill: string
  /** Показывать ли кнопку звонка (личный чат). */
  showCallButton: boolean
  /** Имя текущего пользователя (для мини-аватара в кнопке «Профиль»). */
  selfName: string
  selfAvatarUrl: string | undefined
}>()

const emit = defineEmits<{
  (e: 'open-contacts'): void
  (e: 'toggle-search'): void
  (e: 'open-profile'): void
  (e: 'start-call', kind: 'audio' | 'video'): void
}>()

const peer = computed(() => chatPeer(props.chat, props.currentUserId))
const title = computed<string>(() => chatPeerTitle(props.chat, props.currentUserId))
const peerAvatarUrl = computed<string | undefined>(() => avatarUrlOf(peer.value))

const selfInitial = computed<string>(() => (props.selfName ? initials(props.selfName) : 'U'))

// Кнопка звонка: клик = звонок выбранного типа, удержание 0,5 c = смена типа.
const { callKind, callHolding, callLabel, onCallDown, onCallUp, onCallCancel, onCallClick } =
  useCallButton({
    onTap: () => {
      emit('start-call', callKind.value)
    }
  })
</script>

<style scoped>
.chat-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: #ffffff;
  border-bottom: 1px solid #e2e6ea;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  z-index: 2;
}

.back-btn {
  display: none;
}

.icon-btn {
  background: none;
  border: none;
  color: #52626f;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  cursor: pointer;
}

.icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #202b34;
}

.avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 1rem;
  flex-shrink: 0;
  user-select: none;
  overflow: hidden;
  position: relative;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar.mini {
  width: 30px;
  height: 30px;
  font-size: 0.72rem;
}

.chat-avatar {
  width: 40px;
  height: 40px;
}

.chat-header-info {
  flex: 1;
  min-width: 0;
}

.chat-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.chat-title {
  font-size: 16px;
  font-weight: 600;
  color: #141d26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.chat-status-pill {
  max-width: 170px;
  font-size: 11px;
  font-weight: 600;
  color: #2ea25e;
  background: rgba(46, 162, 94, 0.1);
  border: 1px solid rgba(46, 162, 94, 0.35);
  border-radius: 10px;
  padding: 1px 7px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

.chat-subtitle {
  font-size: 13px;
  color: #7b8a96;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* Кнопка звонка: короткое нажатие = звонок, удержание 0,5 c = смена типа */
.call-group {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.call-btn {
  color: var(--ms-accent, #2ea25e);
  position: relative;
}

.call-btn:hover {
  color: var(--ms-accent, #2ea25e);
}

.call-btn.holding::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid var(--ms-accent, #2ea25e);
  opacity: 0;
  animation: call-hold-ring 0.5s ease-out forwards;
  pointer-events: none;
}

@keyframes call-hold-ring {
  0% {
    opacity: 0.9;
    transform: scale(0.9);
  }
  100% {
    opacity: 0;
    transform: scale(1.5);
  }
}

@media (max-width: 820px) {
  .back-btn {
    display: inline-flex;
  }
}
</style>
