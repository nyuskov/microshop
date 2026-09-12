<template>
  <div ref="rootEl" class="chat-header">
    <button v-if="showBack" class="icon-btn back-btn" title="К списку чатов" @click="emit('back')">
      <q-icon :name="icon('arrow_back')" size="21px" />
    </button>
    <span
      class="avatar-wrap"
      :class="{ online: peerOnline }"
      title="Информация о чате"
      @click="emit('open-info')"
    >
      <span
        class="avatar chat-avatar"
        :style="props.chat.is_self ? savedAvatarStyle : avatarStyle(title)"
      >
        <q-icon v-if="props.chat.is_self" :name="icon('bookmark')" size="22px" aria-hidden="true" />
        <img v-else-if="avatarUrl" :src="avatarUrl" class="avatar-img" alt="" decoding="async" />
        <template v-else>{{ initials(title) }}</template>
      </span>
    </span>
    <div class="chat-header-info" title="Информация о чате" @click="emit('open-info')">
      <div class="chat-title-row">
        <div class="chat-title">{{ title }}</div>
        <span
          v-if="e2ee"
          class="chat-e2ee-pill"
          title="Сквозное шифрование включено: сообщения читаете только вы и собеседник"
        >
          <q-icon :name="icon('lock')" size="13px" aria-hidden="true" />
        </span>
        <span v-if="statusPill" class="chat-status-pill">{{ statusPill }}</span>
      </div>
      <div class="chat-subtitle">
        <span class="chat-subtitle-text">{{ subtitle }}</span>
      </div>
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
          <q-icon :name="icon(callKind === 'video' ? 'videocam' : 'call')" size="20px" />
        </button>
      </span>

      <!-- Остальные действия — под «⋯»: в шапке видна только кнопка звонка. -->
      <span ref="menuWrapEl" class="ms-dropdown-wrap" @click.stop>
        <button
          class="icon-btn"
          :class="{ open: chatMenuOpen }"
          title="Ещё"
          aria-label="Ещё"
          @click="toggleChatMenu"
        >
          <q-icon :name="icon('more_vert')" size="20px" />
        </button>
        <div v-if="chatMenuOpen" class="ms-dropdown">
          <button class="ms-dropdown-item" @click="runChatAction('search')">
            <q-icon :name="icon('search')" size="19px" />
            <span>Поиск по сообщениям</span>
          </button>
          <!-- Жалоба и блокировка — требования RuStore для UGC-приложений.
               Доступны только в личных диалогах (в группе нет одного собеседника,
               там жалуются на конкретное сообщение через его действия). -->
          <template v-if="canModeratePeer">
            <button class="ms-dropdown-item" @click="runChatAction('report')">
              <q-icon :name="icon('flag')" size="19px" />
              <span>Пожаловаться</span>
            </button>
            <button class="ms-dropdown-item danger" @click="runChatAction('block')">
              <q-icon :name="icon('block')" size="19px" />
              <span>Заблокировать</span>
            </button>
          </template>
        </div>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Chat } from '@/types'
import {
  avatarStyle,
  avatarUrlOf,
  chatPeer,
  chatTitle,
  groupAvatarUrl,
  initials,
  isGroupChat
} from '@/utils/user'
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
  /** Показывать ли кнопку «назад» (мобильный режим: drawer поверх списка). */
  showBack: boolean
  /** «В сети» ли собеседник (точка на аватаре). */
  peerOnline: boolean
  /** Включено ли сквозное шифрование в этом чате (показываем 🔒). */
  e2ee?: boolean
  /** Закреплён ли этот чат в списке диалогов. */
  pinned?: boolean
}>()

const emit = defineEmits<{
  /** «Назад» — на мобильном возврат к списку чатов (родитель открывает drawer). */
  (e: 'back'): void
  (e: 'toggle-search'): void
  (e: 'open-info'): void
  (e: 'start-call', kind: 'audio' | 'video'): void
  (e: 'toggle-pin'): void
  /** Жалоба на собеседника (модерация UGC, требование RuStore). */
  (e: 'report-chat'): void
  /** Блокировка собеседника. */
  (e: 'block-chat'): void
}>()

/** Личный диалог с собеседником (не группа и не «Сохранённые сообщения»). */
const canModeratePeer = computed<boolean>(
  () => props.showCallButton && !props.chat.is_self && !!chatPeer(props.chat, props.currentUserId)
)

const peer = computed(() => chatPeer(props.chat, props.currentUserId))
const title = computed<string>(() => chatTitle(props.chat, props.currentUserId))
// Аватар-«книжечка» для «Сохранённых сообщений».
const savedAvatarStyle: Record<string, string> = {
  background: 'linear-gradient(135deg, #3b82f6, #1e40af)'
}
/** Аватар: у группы — своё фото, у личного чата — аватар собеседника. */
const avatarUrl = computed<string | undefined>(() =>
  isGroupChat(props.chat) ? groupAvatarUrl(props.chat) : avatarUrlOf(peer.value)
)

// Меню «⋯» в шапке: закрывается тапом/кликом мимо самого меню.
//
// «Мимо» считаем относительно меню, а не шапки: иначе тап по свободному месту
// в шапке (на телефоне она узкая) меню не закрывал.
const rootEl = ref<HTMLElement | null>(null)
/** Обёртка меню «⋯» (кнопка + выпадающий список). */
const menuWrapEl = ref<HTMLElement | null>(null)
const chatMenuOpen = ref(false)
let outsideHandler: ((event: PointerEvent) => void) | null = null
watch(chatMenuOpen, (open) => {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
  if (open) {
    outsideHandler = (event: PointerEvent) => {
      const wrap = menuWrapEl.value
      if (wrap && !wrap.contains(event.target as Node)) chatMenuOpen.value = false
    }
    document.addEventListener('pointerdown', outsideHandler)
  }
})
onBeforeUnmount(() => {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
})

const toggleChatMenu = () => {
  chatMenuOpen.value = !chatMenuOpen.value
}

const runChatAction = (action: 'search' | 'report' | 'block') => {
  chatMenuOpen.value = false
  if (action === 'search') emit('toggle-search')
  if (action === 'report') emit('report-chat')
  if (action === 'block') emit('block-chat')
}

// Кнопка звонка: клик = звонок выбранного типа, удержание 0,5 c = смена типа.
const { callKind, callHolding, callLabel, onCallDown, onCallUp, onCallCancel, onCallClick } =
  useCallButton({
    onTap: () => {
      emit('start-call', callKind.value)
    }
  })
</script>

<style scoped>
.avatar-wrap,
.chat-header-info {
  cursor: pointer;
}

.chat-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--ms-surface);
  border-bottom: 1px solid var(--ms-border);
  box-shadow: var(--ms-shadow-sm);
  z-index: 2;
}

.back-btn {
  display: inline-flex;
}

.icon-btn:hover {
  background: var(--ms-hover);
  color: var(--ms-text);
}

.avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  color: var(--ms-on-accent);
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

/* Индикатор «в сети» на аватаре собеседника */
.avatar-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}

.avatar-wrap.online::after {
  content: '';
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--ms-accent);
  border: 2px solid var(--ms-surface);
  box-shadow: 0 0 0 1px var(--ms-hairline);
  z-index: 1;
}

.chat-avatar {
  width: 40px;
  height: 40px;
}

.chat-header-info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.chat-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.chat-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--ms-text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

.chat-status-pill {
  max-width: 170px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ms-accent);
  background: var(--ms-accent-soft);
  border: 1px solid var(--ms-accent-border);
  border-radius: 10px;
  padding: 1px 7px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

.chat-subtitle {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 13px;
  color: var(--ms-muted);
}

.chat-subtitle-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Плашка-замок (E2EE) рядом с именем собеседника, как в секретных чатах */
.chat-e2ee-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--ms-accent, #2ea25e);
  background: var(--ms-accent-soft, #e3f2e5);
  border: 1px solid var(--ms-accent-border, rgba(46, 162, 94, 0.35));
  border-radius: 50%;
  width: 20px;
  height: 20px;
  line-height: 1;
}

.chat-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding-left: 4px;
}

.icon-btn.pinned {
  color: var(--ms-accent, #2ea25e);
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

/* Меню «⋯» в шапке чата */
.ms-dropdown-wrap {
  position: relative;
  display: inline-flex;
}

.icon-btn.open {
  color: var(--ms-accent, #1e9b51);
}

.ms-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 210px;
  background: var(--ms-surface);
  border: 1px solid var(--ms-border);
  border-radius: 12px;
  box-shadow: var(--ms-shadow-pop);
  padding: 6px;
  z-index: 130;
  display: flex;
  flex-direction: column;
}

.ms-dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 9px 12px;
  border-radius: 9px;
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  font-family: inherit;
  color: var(--ms-text-strong);
  white-space: nowrap;
}

.ms-dropdown-item:hover {
  background: var(--ms-hover);
}

.ms-dropdown-item .q-icon {
  width: 18px;
  text-align: center;
  color: var(--ms-icon-2);
}

/* ---------- Мобильная адаптация ---------- */
@media (max-width: 480px) {
  .chat-header {
    padding: 8px 10px;
    gap: 8px;
  }
  /* На узких экранах имя/статус меньше — чтобы длинный статус-пилюля не
     прилипал к иконкам справа (звонок/поиск/профиль). */
  .chat-title {
    font-size: 15px;
  }
  .chat-subtitle {
    font-size: 12px;
  }
  .chat-status-pill {
    max-width: 40%;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 9px;
  }
}

@media (max-width: 380px) {
  .chat-header {
    padding: 6px 8px;
    gap: 6px;
  }
  .chat-header .icon-btn {
    width: 30px;
    height: 30px;
  }
  .chat-avatar {
    width: 36px;
    height: 36px;
  }
  .avatar-wrap.online::after {
    width: 11px;
    height: 11px;
  }
  .chat-status-pill {
    max-width: 34%;
    font-size: 9.5px;
  }
}
</style>
