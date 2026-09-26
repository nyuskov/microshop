<template>
  <div ref="rootEl" class="chat-header">
    <button
      v-if="showBack"
      class="icon-btn back-btn"
      :title="t('К списку чатов')"
      @click="emit('back')"
    >
      <q-icon :name="icon('arrow_back')" size="21px" />
    </button>
    <span
      class="avatar-wrap"
      :class="{ online: peerOnline }"
      :title="t('Информация о чате')"
      @click="emit('open-info')"
    >
      <span
        class="avatar chat-avatar"
        :class="{ rounded: chatAvatarRounded(props.chat) }"
        :style="props.chat.is_self ? savedAvatarStyle : avatarStyle(title)"
      >
        <q-icon v-if="props.chat.is_self" :name="icon('bookmark')" size="22px" aria-hidden="true" />
        <img v-else-if="avatarUrl" :src="avatarUrl" class="avatar-img" alt="" decoding="async" />
        <template v-else>{{ initials(title) }}</template>
      </span>
    </span>
    <div class="chat-header-info" :title="t('Информация о чате')" @click="emit('open-info')">
      <!-- Ключ по id чата: при смене чата строки пересоздаются и въезжают снизу
           (см. `chat-swap`) — открылся ДРУГОЙ чат, это видно глазу, а не только
           по подмене текста. Постоянные обновления (статус, «печатает») ключ не
           трогают: элемент не пересоздаётся и не мигает. -->
      <div :key="props.chat.id" class="chat-title-row">
        <div class="chat-title">{{ title }}</div>
      </div>
      <div :key="props.chat.id" class="chat-subtitle">
        <span
          v-if="connectionText"
          class="chat-subtitle-text connection-state"
          :class="connectionState"
          role="status"
        >
          {{ connectionText }}
        </span>
        <template v-else-if="peerTyping">
          <span class="sr-only">{{ t('печатает') }}</span>
          <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </template>
        <span v-else class="chat-subtitle-text">{{ subtitle }}</span>
        <!-- Замок сквозного шифрования — сразу после присутствия, ДО статуса:
             «в сети 🔒 · Работаю…» (уточнение 25.09.2026). Без фона и рамки,
             только акцентный значок. -->
        <span
          v-if="e2ee"
          class="chat-e2ee-pill"
          :title="t('Сквозное шифрование включено: сообщения читаете только вы и собеседник')"
        >
          <q-icon :name="icon('lock')" size="11px" aria-hidden="true" />
        </span>
        <!-- Ручной статус собеседника — в подписи, последним: в строке имени он
             сжимал название чата. При обрыве связи подпись занята состоянием
             сети — статус тогда не показываем. -->
        <template v-if="statusPill && !connectionText">
          <span class="chat-subtitle-sep" aria-hidden="true">·</span>
          <span class="chat-status-pill">{{ statusPill }}</span>
        </template>
      </div>
    </div>
    <div class="chat-header-actions">
      <span v-if="showCallButton" class="call-group" @click.stop>
        <button
          class="icon-btn call-btn"
          :class="{ holding: callHolding }"
          :title="
            t('{kind} — нажмите для звонка, удерживайте 0,5 с для смены типа', {
              kind: callLabel(callKind)
            })
          "
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
          :title="t('Ещё')"
          :aria-label="t('Ещё')"
          @click="toggleChatMenu"
        >
          <q-icon :name="icon('more_vert')" size="20px" />
        </button>
        <div v-if="chatMenuOpen" class="ms-dropdown">
          <button class="ms-dropdown-item" @click="runChatAction('search')">
            <q-icon :name="icon('search')" size="19px" />
            <span>{{ t('Поиск по сообщениям') }}</span>
          </button>
          <!-- Упоминания меня: тот же серверный поиск, но с готовым запросом
               «@логин» — переход по упоминаниям в группе или канале. Пункта нет
               в личных диалогах и «Сохранённых»: там упоминать некого. -->
          <button v-if="mentionLogin" class="ms-dropdown-item" @click="runChatAction('mentions')">
            <q-icon :name="icon('alternate_email')" size="19px" />
            <span>{{ t('Упоминания меня') }}</span>
          </button>
          <!-- Архив: чат уходит в отдельный чип «Архив» в списке, чтобы не мешать
               в «Все». Хранится локально (как пины) — это личная настройка вида. -->
          <button class="ms-dropdown-item" @click="runChatAction('archive')">
            <q-icon :name="icon('archive')" size="19px" />
            <span>{{ archived ? t('Из архива') : t('В архив') }}</span>
          </button>
          <!-- Звук уведомлений этого чата: настройка УСТРОЙСТВА (localStorage) —
               на телефоне и на компьютере она может быть разной. -->
          <button class="ms-dropdown-item" @click="runChatAction('sound')">
            <q-icon :name="icon('volume_up')" size="19px" />
            <span>{{ t('Звук уведомлений') }}</span>
          </button>
          <!-- Папки: свои списки чатов с ручным порядком (настройка устройства). -->
          <button class="ms-dropdown-item" @click="runChatAction('folders')">
            <q-icon :name="icon('folder')" size="19px" />
            <span>{{ t('В папку…') }}</span>
          </button>
          <!-- Статистика: сколько писали, когда и кто активнее (считает сервер). -->
          <button class="ms-dropdown-item" @click="runChatAction('stats')">
            <q-icon :name="icon('bar_chart')" size="19px" />
            <span>{{ t('Статистика чата') }}</span>
          </button>
          <!-- Показ/скрытие шторки закреплённых: единственное место с этим
               действием — отдельной кнопки в шапке нет, чтобы не дублировать. -->
          <button
            v-if="hasPinned"
            class="ms-dropdown-item"
            :class="{ on: !pinnedHidden }"
            @click="runChatAction('pinned')"
          >
            <q-icon :name="icon(pinnedHidden ? 'push_pin' : 'visibility')" size="19px" />
            <span>{{ pinnedHidden ? t('Показать закреплённые') : t('Скрыть закреплённые') }}</span>
          </button>
          <!-- Жалоба и блокировка — требования RuStore для UGC-приложений.
               Доступны только в личных диалогах (в группе нет одного собеседника,
               там жалуются на конкретное сообщение через его действия).
               Блокировка бывает двух видов: полная и «только звонки» — вторая
               оставляет переписку, но запрещает дозвон (жалоба «не звони мне»). -->
          <template v-if="canModeratePeer">
            <button class="ms-dropdown-item" @click="runChatAction('report')">
              <q-icon :name="icon('flag')" size="19px" />
              <span>{{ t('Пожаловаться') }}</span>
            </button>
            <!-- При полной блокировке запрещено всё, поэтому отдельный пункт про
                 звонки не показываем — достаточно «Разблокировать». -->
            <button
              v-if="!blocked"
              class="ms-dropdown-item"
              :class="{ on: callsBlocked }"
              @click="runChatAction('calls')"
            >
              <q-icon :name="icon(callsBlocked ? 'call' : 'call_end')" size="19px" />
              <span>{{ callsBlocked ? t('Принимать звонки') : t('Не принимать звонки') }}</span>
            </button>
            <button class="ms-dropdown-item danger" @click="runChatAction('block')">
              <q-icon :name="icon('block')" size="19px" />
              <span>{{ blocked ? t('Разблокировать') : t('Заблокировать') }}</span>
            </button>
          </template>
        </div>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { t } from '@/i18n'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Chat } from '@/types'
import {
  avatarStyle,
  avatarUrlOf,
  chatAvatarRounded,
  chatPeer,
  chatTitle,
  groupAvatarUrl,
  initials,
  isGroupChat
} from '@/utils/user'
import { useCallButton } from '@/composables/useCallButton'
import { useOnlineStatus } from '@/composables/useOnlineStatus'

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
  /** Печатает ли собеседник: подпись заменяется анимированными точками. */
  peerTyping?: boolean
  /** Включено ли сквозное шифрование в этом чате (показываем 🔒). */
  e2ee?: boolean
  /** Закреплён ли этот чат в списке диалогов. */
  pinned?: boolean
  /** Лежит ли этот чат в архиве (меняет подпись пункта меню). */
  archived?: boolean
  /** Заблокирован ли собеседник ПОЛНОСТЬЮ (переписка и звонки запрещены). */
  blocked?: boolean
  /** Запрещены ли только звонки («не звони мне, но писать можно»). */
  callsBlocked?: boolean
  /** Есть ли в чате закреплённые сообщения (есть что показывать). */
  hasPinned?: boolean
  /** Скрыта ли шторка закреплённых — нужна кнопка, чтобы вернуть её обратно. */
  pinnedHidden?: boolean
  /**
   * Мой логин для перехода по упоминаниям (`@логин` в серверном поиске).
   * Пусто — чат личный или упоминать в нём некого, и пункта меню нет.
   */
  mentionLogin?: string
}>()

const emit = defineEmits<{
  /** «Назад» — на мобильном возврат к списку чатов (родитель открывает drawer). */
  (e: 'back'): void
  (e: 'toggle-search'): void
  (e: 'open-info'): void
  (e: 'start-call', kind: 'audio' | 'video'): void
  (e: 'toggle-pin'): void
  /** В архив или обратно. */
  (e: 'toggle-archive'): void
  /** Выбор звука уведомлений этого чата (настройка устройства). */
  (e: 'open-chat-sound'): void
  /** Статистика чата: сообщения по дням, участники, вложения. */
  (e: 'open-chat-stats'): void
  /** Папки чатов: отметить, в каких папках виден этот чат. */
  (e: 'open-chat-folders'): void
  /** Запретить/разрешить звонки от собеседника (мягкая блокировка). */
  (e: 'toggle-calls-block'): void
  /** Жалоба на собеседника (модерация UGC, требование RuStore). */
  (e: 'report-chat'): void
  /** Блокировка собеседника. */
  (e: 'block-chat'): void
  /** Скрыть или показать шторку закреплённых (пункт меню «⋯»). */
  (e: 'toggle-pinned'): void
  /** Перейти к упоминаниям меня: поиск с готовым запросом `@логин`. */
  (e: 'open-mentions'): void
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

/**
 * Моя связь — вместо присутствия собеседника.
 *
 * Присутствие приходит по сети, поэтому при обрыве про собеседника всё равно
 * ничего не узнать. Состояние берём общее (`state` из `useOnlineStatus`) — то же,
 * что показывает пилюля в шапке списка чатов: про обрыв в открытом чате иначе не
 * сообщалось бы вовсе, а на телефоне шапка списка в этот момент скрыта.
 */
const { state: connectionState } = useOnlineStatus()

const connectionText = computed(() => {
  if (connectionState.value === 'offline') return t('Нет сети')
  if (connectionState.value === 'connecting') return t('Соединение…')
  if (connectionState.value === 'restored') return t('Связь восстановлена')
  return ''
})

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

const runChatAction = (
  action:
    | 'search'
    | 'mentions'
    | 'archive'
    | 'folders'
    | 'sound'
    | 'stats'
    | 'calls'
    | 'report'
    | 'block'
    | 'pinned'
) => {
  chatMenuOpen.value = false
  if (action === 'search') emit('toggle-search')
  if (action === 'mentions') emit('open-mentions')
  if (action === 'archive') emit('toggle-archive')
  if (action === 'folders') emit('open-chat-folders')
  if (action === 'sound') emit('open-chat-sound')
  if (action === 'stats') emit('open-chat-stats')
  if (action === 'pinned') emit('toggle-pinned')
  if (action === 'calls') emit('toggle-calls-block')
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
  /* Линия-разделитель — inset-тень, а не border-bottom: бордер входил в
     border-box, и все значки (flex `align-items: center`) вставали на 0,5 px
     выше визуального центра шапки — на телефоне это заметно глазом. */
  box-shadow:
    inset 0 -1px 0 var(--ms-border),
    var(--ms-shadow-sm);
  z-index: 2;
}

.back-btn {
  display: inline-flex;
}

/* ВАЖНО (25.09.2026): не «поправлять» оптику значков сдвигами вверх. Пробовал
   поднимать глифы на 1 px / 0,5 px по пиксельному замеру чернил — владелец
   увидел, что значки встали ВЫШЕ центра кнопок, и попросил опустить. Значки
   должны стоять ровно по центру круга (как их ставит flex `align-items: center`),
   без самодельных translateY: замер боксов даёт delta 0 у «назад», звонка и «⋯». */

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

/* Аватар группы и канала — скруглённый квадрат, личного чата — круг: форма
   различает тип чата (см. `chatAvatarRounded` в `utils/user.ts`). */
.avatar.rounded {
  border-radius: var(--ms-radius-lg);
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
  /* Имя и подпись — две строки в колонку с зазором 2 px. Без него строки
     соприкасались и шапка читалась «одним куском» (жалоба 25.09.2026). */
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

/* Смена чата: название и подпись въезжают снизу за 0,16 s. Уходящий кадр не
   держим — задержка на каждый тап по списку была бы навязчивой. */
.chat-title-row,
.chat-subtitle {
  animation: chat-swap 0.16s var(--ms-ease);
}

@keyframes chat-swap {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: none;
  }
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

/* Ручной статус собеседника — в подписи, после «в сети»: приглушённый текст без
   плашки (в Telegram статус никак не выделен). Разделитель «·» тише самого
   статуса и не сжимается, чтобы не превратиться в точку посередине строки. */
.chat-subtitle-sep {
  flex-shrink: 0;
  color: var(--ms-muted-3);
}

.chat-status-pill {
  max-width: 200px;
  font-size: var(--ms-fs-sm);
  font-weight: 400;
  color: var(--ms-muted-2);
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

/* Моя связь вместо присутствия собеседника: про собеседника при обрыве всё
   равно ничего не узнать. Красная подпись — нет связи, обычная — «Соединение…». */
.connection-state.offline {
  color: var(--ms-danger);
}

.chat-subtitle-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Замок сквозного шифрования — маленький акцентный значок в подписи (рядом с
   «в сети»). Фона и рамки нет намеренно (просьба 25.09.2026): раньше это была
   зелёная пилюля 20 px в строке имени, и вместе с ручным статусом она
   сжимала название чата. */
.chat-e2ee-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--ms-accent, #2ea25e);
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
  border-radius: var(--ms-radius-lg);
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
  border-radius: var(--ms-radius-sm);
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
    padding: 10px;
    gap: 8px;
  }
  /* На узких экранах имя/статус меньше — чтобы длинный статус-пилюля не
     прилипал к иконкам справа (звонок/профиль). */
  .chat-title {
    font-size: 15px;
  }
  .chat-subtitle {
    font-size: 12px;
  }
  /* Кнопки действий по 38 px (палец) стояли с зазором 2 px — визуально слипались.
     Даём зазор и отступ от текста; имя от этого теряет всего ~6 px и всё равно
     обрезается эллипсисом, а не «врастает» в иконки (жалоба 25.09.2026). */
  .chat-header-actions {
    gap: 6px;
    padding-left: 6px;
  }
  .chat-status-pill {
    max-width: 60%;
    font-size: var(--ms-fs-xs);
  }
}

@media (max-width: 380px) {
  .chat-header {
    padding: 8px;
    gap: 6px;
  }
  /* Кнопки НЕ уменьшаем: на самом узком экране они и так впритык для пальца
     (общий размер для телефона — 38 px в appearance.css). */
  .chat-avatar {
    width: 36px;
    height: 36px;
  }
  .avatar-wrap.online::after {
    width: 11px;
    height: 11px;
  }
  .chat-header-actions {
    gap: 4px;
    padding-left: 4px;
  }
  .chat-status-pill {
    max-width: 55%;
    font-size: var(--ms-fs-xs);
  }
}
</style>
