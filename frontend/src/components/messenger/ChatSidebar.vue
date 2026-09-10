<template>
  <aside ref="rootEl" class="side-panel">
    <!-- Диалоги -->
    <template v-if="view === 'chats'">
      <!-- Режим выделения чатов (вход по удержанию) -->
      <div v-if="selectionMode" class="selection-bar">
        <button class="icon-btn" title="Отмена" @click="exitSelection">
          <q-icon name="close" size="20px" />
        </button>
        <span class="selection-count">{{ selectedIds.length }}</span>
        <div class="selection-actions">
          <button
            class="icon-btn"
            :class="{ on: selectionAllMuted }"
            :title="selectionAllMuted ? 'Включить уведомления' : 'Замьютить выбранные'"
            aria-label="Мьют/анмьют выбранных"
            @click="onBulkMute"
          >
            <q-icon :name="selectionAllMuted ? 'notifications' : 'notifications_off'" size="20px" />
          </button>
          <button
            class="icon-btn"
            :class="{ on: selectionAllPinned }"
            :title="selectionAllPinned ? 'Открепить выбранные' : 'Закрепить выбранные'"
            aria-label="Пин/анпин выбранных"
            @click="onBulkPin"
          >
            <q-icon name="push_pin" size="20px" />
          </button>
          <button
            class="icon-btn danger"
            title="Удалить выбранные"
            aria-label="Удалить выбранные"
            @click="onBulkDelete"
          >
            <q-icon name="delete" size="20px" />
          </button>
          <button
            class="icon-btn"
            :class="{ on: allVisibleSelected }"
            title="Выбрать все"
            aria-label="Выбрать все"
            @click="toggleSelectAll"
          >
            <q-icon name="done_all" size="20px" />
          </button>
        </div>
      </div>
      <div v-else class="panel-header">
        <div class="panel-header-left">
          <button class="icon-btn" title="Контакты" @click="emit('to-contacts')">
            <q-icon name="person_add" size="20px" />
          </button>
        </div>
        <h2 class="panel-title">Чаты</h2>
        <div class="panel-header-right">
          <button class="icon-btn" title="Поиск" aria-label="Поиск" @click="openSearch">
            <q-icon name="search" size="20px" />
          </button>
          <span class="ms-dropdown-wrap" @click.stop>
            <button
              class="icon-btn"
              :class="{ open: settingsMenuOpen }"
              title="Настройки"
              @click="toggleSettingsMenu"
            >
              <q-icon name="more_vert" size="20px" />
            </button>
            <div v-if="settingsMenuOpen" class="ms-dropdown">
              <button
                v-for="action in SETTINGS_ACTIONS"
                :key="action.key"
                class="ms-dropdown-item"
                @click="runSettingsAction(action)"
              >
                <q-icon :name="action.icon" size="19px" />
                <span>{{ action.label }}</span>
              </button>
            </div>
          </span>
          <!-- Профиль (свой аватар) — в правом крае, чтобы не путался с «Контактами» -->
          <button
            class="self-profile-btn"
            title="Профиль"
            aria-label="Профиль"
            @click="emit('open-profile')"
          >
            <span class="avatar self-avatar" :style="avatarStyle(selfName)">
              <img v-if="selfAvatarUrl" :src="selfAvatarUrl" class="avatar-img" alt="" />
              <template v-else>{{ selfName ? initials(selfName) : 'U' }}</template>
            </span>
          </button>
        </div>
      </div>

      <!-- Глобальный поиск: открывается по значку и прячет верхний хидер,
           как панель действий при выделении чатов удержанием. -->
      <div v-if="!selectionMode && searchOpen" class="panel-search search-head">
        <button class="icon-btn search-back" title="Назад" aria-label="Назад" @click="closeSearch">
          <q-icon name="arrow_back" size="20px" />
        </button>
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          class="panel-search-input"
          type="text"
          placeholder="Поиск людей и сообщений"
          aria-label="Глобальный поиск"
          @keydown.esc="closeSearch"
        />
        <button
          v-if="searchQuery.trim()"
          class="icon-btn search-clear"
          title="Очистить"
          aria-label="Очистить"
          @click="searchQuery = ''"
        >
          <q-icon name="close" size="18px" />
        </button>
      </div>

      <div v-if="searchError" class="inline-error">{{ searchError }}</div>

      <!-- Результаты поиска: люди / сообщения -->
      <div v-if="searchOpen && searchQuery.trim()" class="people-results">
        <div class="search-mode-tabs" role="tablist" aria-label="Область поиска">
          <button
            class="search-mode-tab"
            :class="{ active: searchMode === 'people' }"
            role="tab"
            :aria-selected="searchMode === 'people'"
            @click="setSearchMode('people')"
          >
            Люди
          </button>
          <button
            class="search-mode-tab"
            :class="{ active: searchMode === 'messages' }"
            role="tab"
            :aria-selected="searchMode === 'messages'"
            @click="setSearchMode('messages')"
          >
            Сообщения
          </button>
        </div>

        <div v-if="searching" class="search-status">Поиск…</div>

        <!-- Люди -->
        <template v-else-if="searchMode === 'people' && userResults.length">
          <div class="section-label">Найти людей</div>
          <button
            v-for="user in userResults"
            :key="user.id"
            class="row-item"
            @click="openChatWithUser(user)"
          >
            <span class="avatar" :style="avatarStyle(displayName(user))">
              <img v-if="avatarUrlOf(user)" :src="avatarUrlOf(user)" class="avatar-img" alt="" />
              <template v-else>{{ initials(displayName(user)) }}</template>
            </span>
            <span class="row-text">
              <span class="row-title">{{ displayName(user) }}</span>
              <span class="row-sub"
                >@{{ user.username
                }}<template v-if="user.phone_number"> · {{ user.phone_number }}</template></span
              >
            </span>
            <q-icon name="chevron_right" class="row-arrow" size="20px" />
          </button>
        </template>
        <div v-else-if="searchMode === 'people'" class="search-status">Никого не найдено</div>

        <!-- Сообщения (по всем диалогам) -->
        <template v-else-if="searchMode === 'messages' && messageResults.length">
          <div class="section-label">Найдено в чатах</div>
          <button
            v-for="msg in messageResults"
            :key="msg.id"
            class="row-item"
            @click="openMessageResult(msg)"
          >
            <span class="avatar" :style="avatarStyle(messageChatTitle(msg))">
              <img
                v-if="messageChatAvatar(msg)"
                :src="messageChatAvatar(msg)"
                class="avatar-img"
                alt=""
              />
              <template v-else>{{ initials(messageChatTitle(msg)) }}</template>
            </span>
            <span class="row-text">
              <span class="row-line">
                <span class="row-title msg-result-chat">{{ messageChatTitle(msg) }}</span>
                <span class="row-time">{{ formatMsgTime(msg.timestamp) }}</span>
              </span>
              <span class="row-sub msg-result-snippet">
                {{ messageSenderPrefix(msg) }}{{ messageSnippetText(msg) }}
              </span>
            </span>
            <q-icon name="chevron_right" class="row-arrow" size="20px" />
          </button>
        </template>
        <div v-else-if="searchMode === 'messages'" class="search-status">Ничего не найдено</div>
      </div>

      <div v-if="!searchOpen && loadingChats" class="search-status">Загрузка…</div>

      <!-- Недавние диалоги (скрыты, пока открыт глобальный поиск) -->
      <template v-else-if="!searchOpen">
        <div class="section-label">Недавние</div>
        <div v-if="!orderedChats.length" class="empty-hint">
          Найдите пользователя по логину или телефону и начните переписку
        </div>
        <div class="chat-scroll">
          <div v-for="chat in orderedChats" :key="chat.id" class="chat-row">
            <button
              class="row-item"
              :class="{
                active: !selectionMode && selectedChatId === chat.id,
                selected: isSelected(chat.id)
              }"
              @pointerdown="onRowPointerDown(chat.id)"
              @pointerup="onRowPointerUp"
              @pointercancel="onRowPointerCancel"
              @pointerleave="onRowPointerUp"
              @click="onRowClick(chat.id)"
            >
              <span v-if="selectionMode" class="row-selector" :class="{ on: isSelected(chat.id) }">
                <q-icon v-if="isSelected(chat.id)" name="check" size="15px" />
              </span>
              <span class="avatar-wrap" :class="{ online: chatPeerOnline(chat) }">
                <span
                  class="avatar"
                  :style="chat.is_self ? savedStyle : avatarStyle(chatTitleOf(chat))"
                >
                  <q-icon v-if="chat.is_self" name="bookmark" size="20px" aria-hidden="true" />
                  <img
                    v-else-if="chatAvatarOf(chat)"
                    :src="chatAvatarOf(chat)"
                    class="avatar-img"
                    alt=""
                  />
                  <template v-else>{{ initials(chatTitleOf(chat)) }}</template>
                </span>
              </span>
              <span class="row-text">
                <span class="row-line">
                  <span class="row-title">{{ chatTitleOf(chat) }}</span>
                  <span class="row-time">
                    <q-icon
                      v-if="isMutedOf(chat.id)"
                      name="notifications_off"
                      size="14px"
                      class="row-muted"
                      aria-hidden="true"
                    />
                    {{ chat.last_message ? formatChatTime(chat.last_message.timestamp) : '' }}
                  </span>
                </span>
                <span class="row-line">
                  <span
                    class="row-sub preview"
                    :class="{ typing: isChatTyping(chat), draft: draftOf(chat) !== null }"
                  >
                    <template v-if="isChatTyping(chat)">печатает…</template>
                    <template v-else-if="draftOf(chat)">Черновик: {{ draftOf(chat) }}</template>
                    <template v-else>
                      <q-icon v-if="lastMessageIsOut(chat)" name="done" class="tick" size="16px" />
                      {{ previewText(chat) }}
                    </template>
                  </span>
                  <span v-if="chat.unread_count > 0" class="unread-badge">
                    {{ chat.unread_count }}
                  </span>
                </span>
              </span>
            </button>
          </div>
        </div>
      </template>

      <!-- Пустой глобальный поиск: подсказка вместо списка -->
      <template v-else-if="searchOpen && !searchQuery.trim()">
        <div class="search-hint">
          <q-icon name="search" class="search-hint-icon" size="30px" />
          <p>Поиск по людям и сообщениям<br />во всех чатах</p>
        </div>
      </template>
    </template>

    <!-- Контакты -->
    <template v-else>
      <div class="panel-header">
        <div class="panel-header-left">
          <button class="icon-btn" title="Назад к чатам" @click="emit('to-chats')">
            <q-icon name="arrow_back" size="20px" />
          </button>
        </div>
        <h2 class="panel-title">Контакты</h2>
        <div class="panel-header-right">
          <button
            class="icon-btn"
            title="Добавить из контактов телефона"
            aria-label="Добавить из контактов телефона"
            @click="onAddFromPhone"
          >
            <q-icon name="contacts" size="20px" />
          </button>
          <span class="ms-dropdown-wrap" @click.stop>
            <button
              class="icon-btn"
              :class="{ open: settingsMenuOpen }"
              title="Настройки"
              @click="toggleSettingsMenu"
            >
              <q-icon name="more_vert" size="20px" />
            </button>
            <div v-if="settingsMenuOpen" class="ms-dropdown">
              <button
                v-for="action in SETTINGS_ACTIONS"
                :key="action.key"
                class="ms-dropdown-item"
                @click="runSettingsAction(action)"
              >
                <q-icon :name="action.icon" size="19px" />
                <span>{{ action.label }}</span>
              </button>
            </div>
          </span>
        </div>
      </div>

      <div class="panel-search">
        <q-icon name="search" class="search-icon" size="17px" />
        <input
          v-model="contactsQuery"
          class="panel-search-input"
          type="text"
          placeholder="Поиск по логину или телефону"
          aria-label="Поиск контактов"
        />
      </div>

      <!-- Результаты импорта из телефонной книги (показываются прямо в списке) -->
      <div v-if="phoneMatched !== null && !phoneImportOpen" class="phone-inline">
        <div class="phone-inline-head">
          <span class="phone-result-title"> Из телефонной книги: {{ phoneMatched.length }} </span>
          <button
            class="phone-inline-clear"
            title="Закрыть результаты"
            aria-label="Закрыть результаты"
            @click="clearPhoneMatch"
          >
            <q-icon name="close" size="18px" />
          </button>
        </div>
        <p v-if="phoneError" class="phone-error">{{ phoneError }}</p>
        <div v-if="!phoneBusy && !phoneMatched.length" class="empty-hint">
          Никого из вашей книги нет в мессенджере
        </div>
        <div v-else class="phone-inline-list">
          <button
            v-for="user in phoneMatched"
            :key="user.id"
            class="row-item"
            @click="openPhoneMatch(user)"
          >
            <span class="avatar" :style="avatarStyle(displayName(user))">
              <img v-if="avatarUrlOf(user)" :src="avatarUrlOf(user)" class="avatar-img" alt="" />
              <template v-else>{{ initials(displayName(user)) }}</template>
            </span>
            <span class="row-text">
              <span class="row-title">{{ displayName(user) }}</span>
              <span class="row-sub"
                >@{{ user.username
                }}<template v-if="user.phone_number"> · {{ user.phone_number }}</template></span
              >
            </span>
            <q-icon name="chat_bubble" class="row-arrow" size="18px" />
          </button>
        </div>
      </div>

      <!-- Обычный список контактов (скрыт, пока показаны результаты из книги) -->
      <template v-if="phoneMatched === null || phoneImportOpen">
        <div v-if="contactsLoading" class="search-status">Загрузка…</div>
        <div v-else-if="!filteredContacts.length" class="empty-hint">Контакты не найдены</div>
        <div v-else class="chat-scroll">
          <button
            v-for="contact in filteredContacts"
            :key="contact.id"
            class="row-item"
            @click="openChatWithContact(contact)"
          >
            <span class="avatar" :style="avatarStyle(displayName(contact))">
              <img
                v-if="avatarUrlOf(contact)"
                :src="avatarUrlOf(contact)"
                class="avatar-img"
                alt=""
              />
              <template v-else>{{ initials(displayName(contact)) }}</template>
            </span>
            <span class="row-text">
              <span class="row-title">{{ displayName(contact) }}</span>
              <span class="row-sub"
                >@{{ contact.username
                }}<template v-if="contact.phone_number">
                  · {{ contact.phone_number }}</template
                ></span
              >
            </span>
            <q-icon name="chevron_right" class="row-arrow" size="20px" />
          </button>
        </div>
      </template>
    </template>
  </aside>

  <!-- Импорт контактов из телефонной книги -->
  <Teleport to="body">
    <div
      v-if="phoneImportOpen"
      class="phone-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Добавить из контактов телефона"
      @mousedown.self="closePhoneImport"
    >
      <div class="phone-card">
        <header class="phone-head">
          <div class="phone-title">
            <q-icon name="contacts" size="18px" />
            <span>Из контактов телефона</span>
          </div>
          <button class="phone-xbtn" title="Закрыть" @click="closePhoneImport">
            <q-icon name="close" size="20px" />
          </button>
        </header>

        <div class="phone-body">
          <button
            v-if="phoneContactsSupported"
            class="phone-primary"
            :disabled="phoneBusy"
            @click="pickDeviceContacts"
          >
            <q-icon name="phone_android" size="20px" />
            <span>{{ phoneBusy ? 'Открываем…' : 'Выбрать из телефонной книги' }}</span>
          </button>
          <p v-else class="phone-hint">
            Браузер не открывает книгу напрямую — вставьте номера ниже (по одному в строке).
          </p>

          <div class="phone-or"><span>или</span></div>

          <label class="phone-label" for="phone-textarea">Номера телефонов</label>
          <textarea
            id="phone-textarea"
            v-model="manualPhones"
            class="phone-textarea"
            rows="5"
            placeholder="+7 999 123-45-67&#10;+7 912 000-00-00"
          ></textarea>

          <div class="phone-actions">
            <button class="phone-btn ghost" :disabled="phoneBusy" @click="closePhoneImport">
              Отмена
            </button>
            <button class="phone-btn primary" :disabled="phoneBusy" @click="findByManualPhones">
              {{ phoneBusy ? 'Поиск…' : 'Найти в мессенджере' }}
            </button>
          </div>

          <p v-if="phoneError" class="phone-error">{{ phoneError }}</p>

          <template v-if="phoneMatched !== null">
            <p class="phone-result-title">Найдено в мессенджере: {{ phoneMatched.length }}</p>
            <div v-if="!phoneMatched.length" class="phone-empty">
              Никого из вашей книги нет в мессенджере
            </div>
            <div v-else class="phone-results">
              <button
                v-for="user in phoneMatched"
                :key="user.id"
                class="phone-row"
                @click="openPhoneMatch(user)"
              >
                <span class="avatar" :style="avatarStyle(displayName(user))">
                  <img
                    v-if="avatarUrlOf(user)"
                    :src="avatarUrlOf(user)"
                    class="avatar-img"
                    alt=""
                  />
                  <template v-else>{{ initials(displayName(user)) }}</template>
                </span>
                <span class="phone-row-text">
                  <span class="phone-row-name">{{ displayName(user) }}</span>
                  <span class="phone-row-phone">@{{ user.username }}</span>
                </span>
                <q-icon name="chat_bubble" class="phone-row-icon" size="18px" />
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getErrorMessage } from '@/services/errors'
import {
  matchUsersByPhone,
  openPrivateChat,
  searchMessages,
  searchUsers,
  type SearchUserResult
} from '@/services/chatService'
import type { Chat, ChatUser, Message } from '@/types'
import { isEncryptedPayload } from '@/services/e2ee'
import {
  avatarStyle,
  avatarUrlOf,
  chatPeer,
  chatTitle,
  displayName,
  groupAvatarUrl,
  initials,
  isGroupChat
} from '@/utils/user'
import { ONLINE_WINDOW_SECONDS, formatChatTime, formatMsgTime } from '@/utils/format'
import { mediaTypeLabel } from '@/utils/media'

const props = defineProps<{
  view: 'chats' | 'contacts'
  currentUserId: number | null
  chats: Chat[]
  contacts: SearchUserResult[]
  selectedChatId: number | null
  loadingChats: boolean
  contactsLoading: boolean
  /** id пользователей, которые сейчас «в сети» (присутствие из WS). */
  onlineUserIds?: number[]
  /** id чатов, где собеседник сейчас печатает. */
  typingChatIds?: number[]
  /** id закреплённых чатов (показываются вверху списка). */
  pinnedChatIds?: number[]
  /** id замьюченных чатов (без всплывающих уведомлений). */
  mutedChatIds?: number[]
  /** Сохранённые черновики по id чата (показываются в превью). */
  drafts?: Record<number, string>
  /** Имя и аватар текущего пользователя (кнопка «Профиль» слева). */
  selfName: string
  selfAvatarUrl: string | undefined
  /** Администратор: показывает в «⋯» разбор жалоб. */
  isAdmin?: boolean
}>()

const emit = defineEmits<{
  (e: 'to-contacts'): void
  (e: 'to-chats'): void
  (e: 'open-profile'): void
  (e: 'open-appearance'): void
  (e: 'select-chat', chatId: number): void
  (e: 'chat-opened', chat: Chat): void
  (e: 'open-message', chatId: number, messageId: number): void
  (e: 'toggle-pin', chatId: number): void
  (e: 'toggle-mute', chatId: number): void
  (e: 'delete-chat', chat: Chat): void
  (e: 'bulk-mute', chatIds: number[], muted: boolean): void
  (e: 'bulk-pin', chatIds: number[], pinned: boolean): void
  (e: 'bulk-delete', chatIds: number[]): void
  /** Открыть диалог «Новая группа». */
  (e: 'create-group'): void
  /** Открыть список заблокированных пользователей. */
  (e: 'open-blocked'): void
  /** Открыть разбор жалоб (только администраторы). */
  (e: 'open-reports'): void
}>()

/** Пункт меню «⋯»: иконка Material + подпись. */
interface SettingsAction {
  key: 'group' | 'blocked' | 'reports' | 'appearance'
  label: string
  icon: string
}

// Пункты верхнего меню «⋯»; «Жалобы» видят только администраторы.
const SETTINGS_ACTIONS = computed<SettingsAction[]>(() => {
  const items: SettingsAction[] = [
    { key: 'group', label: 'Новая группа', icon: 'group_add' },
    { key: 'blocked', label: 'Заблокированные', icon: 'block' }
  ]
  if (props.isAdmin) items.push({ key: 'reports', label: 'Жалобы', icon: 'flag' })
  items.push({ key: 'appearance', label: 'Оформление и тема', icon: 'palette' })
  return items
})

const rootEl = ref<HTMLElement | null>(null)
const settingsMenuOpen = ref(false)

// Клик вне панели закрывает «⋯» (раньше это делал closePopups() в Messenger).
let outsideHandler: ((event: PointerEvent) => void) | null = null
watch(settingsMenuOpen, (open) => {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
  if (open) {
    outsideHandler = (event: PointerEvent) => {
      const el = rootEl.value
      if (el && !el.contains(event.target as Node)) settingsMenuOpen.value = false
    }
    document.addEventListener('pointerdown', outsideHandler)
  }
})

const searchQuery = ref('')
const searching = ref(false)
const searchMode = ref<'people' | 'messages'>('people')
const userResults = ref<SearchUserResult[]>([])
const messageResults = ref<Message[]>([])
const searchError = ref('')
const contactsQuery = ref('')

const searchInputRef = ref<HTMLInputElement | null>(null)

const chatPeerOf = (chat: Chat) => chatPeer(chat, props.currentUserId)
const chatTitleOf = (chat: Chat): string => chatTitle(chat, props.currentUserId)
/** Аватар чата: у группы — своё фото, у личного — аватар собеседника. */
const chatAvatarOf = (chat: Chat): string | undefined =>
  isGroupChat(chat) ? groupAvatarUrl(chat) : avatarUrlOf(chatPeerOf(chat))
// Аватар-«книжечка» для «Сохранённых сообщений».
const savedStyle: Record<string, string> = {
  background: 'linear-gradient(135deg, #3b82f6, #1e40af)'
}

/** «В сети»: пользователь в списке присутствия либо был активен недавно. */
const isUserOnline = (user: ChatUser | undefined | null): boolean => {
  if (!user) return false
  if (props.onlineUserIds?.includes(user.id)) return true
  if (!user.last_seen) return false
  const seen = new Date(user.last_seen).getTime()
  if (Number.isNaN(seen)) return false
  return Date.now() - seen <= ONLINE_WINDOW_SECONDS * 1000
}

/** Индикатор онлайн показываем только у личных (1-1) чатов. */
const chatPeerOnline = (chat: Chat): boolean => {
  if (chat.users.length !== 2) return false
  return isUserOnline(chatPeerOf(chat))
}

/** Печатает ли сейчас собеседник в этом чате. */
const isChatTyping = (chat: Chat): boolean =>
  chat.users.length === 2 && (props.typingChatIds?.includes(chat.id) ?? false)

/** Закреплён ли чат. */
const isPinnedOf = (chatId: number): boolean => props.pinnedChatIds?.includes(chatId) ?? false

/** Замьючен ли чат. */
const isMutedOf = (chatId: number): boolean => props.mutedChatIds?.includes(chatId) ?? false

// ---------- Режим выделения чатов (long-press; как в Telegram) ----------
// Вход: удержание на чате (~0,5 с). В режиме выделения клик по чату —
// отметить/снять; сверху появляется панель действий (мьют/удалить/выбрать все).
const selectionMode = ref(false)
const selectedIds = ref<number[]>([])

const isSelected = (chatId: number): boolean => selectedIds.value.includes(chatId)

const exitSelection = () => {
  selectionMode.value = false
  selectedIds.value = []
}

const toggleSelect = (chatId: number) => {
  const next = new Set(selectedIds.value)
  if (next.has(chatId)) {
    next.delete(chatId)
  } else {
    next.add(chatId)
  }
  selectedIds.value = Array.from(next)
  if (selectedIds.value.length === 0) selectionMode.value = false
}

let holdTimer: number | null = null
let suppressClick = false

const cancelHold = () => {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer)
    holdTimer = null
  }
}

const onRowPointerDown = (chatId: number) => {
  if (selectionMode.value) return
  cancelHold()
  suppressClick = false
  holdTimer = window.setTimeout(() => {
    holdTimer = null
    selectionMode.value = true
    selectedIds.value = [chatId]
    suppressClick = true // клик, которым завершилось удержание, чат не открывает
  }, 480)
}

const onRowPointerUp = () => {
  cancelHold()
}

const onRowPointerCancel = () => {
  cancelHold()
  suppressClick = false
}

const onRowClick = (chatId: number) => {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (selectionMode.value) {
    toggleSelect(chatId)
    return
  }
  selectChat(chatId)
}

const allVisibleSelected = computed<boolean>(() => {
  const visible = orderedChats.value.map((chat) => chat.id)
  return visible.length > 0 && visible.every((id) => selectedIds.value.includes(id))
})

const selectionAllMuted = computed<boolean>(() => {
  if (selectedIds.value.length === 0) return false
  return selectedIds.value.every((id) => isMutedOf(id))
})

const selectionAllPinned = computed<boolean>(() => {
  if (selectedIds.value.length === 0) return false
  return selectedIds.value.every((id) => isPinnedOf(id))
})

const toggleSelectAll = () => {
  if (allVisibleSelected.value) {
    exitSelection()
  } else {
    selectedIds.value = orderedChats.value.map((chat) => chat.id)
    if (selectedIds.value.length === 0) selectionMode.value = false
  }
}

const onBulkMute = () => {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const muted = !selectionAllMuted.value
  exitSelection()
  emit('bulk-mute', ids, muted)
}

const onBulkPin = () => {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const pinned = !selectionAllPinned.value
  exitSelection()
  emit('bulk-pin', ids, pinned)
}

const onBulkDelete = () => {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  exitSelection()
  emit('bulk-delete', ids)
}

// Выход из режима выделения при внешних изменениях (смена вкладки/чата).
watch([() => props.view, () => props.selectedChatId], () => {
  if (selectionMode.value) exitSelection()
})

/** Сохранённый черновик чата (null — черновика нет). */
const draftOf = (chat: Chat): string | null => {
  const text = props.drafts?.[chat.id]
  return text && text.trim() ? text : null
}

const filteredChats = computed<Chat[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.chats
  return props.chats.filter((chat) => {
    const title = chatTitleOf(chat)
    const peer = chatPeerOf(chat)
    const phone = peer?.phone_number ?? ''
    return (
      title.toLowerCase().includes(query) ||
      chat.name.toLowerCase().includes(query) ||
      phone.toLowerCase().includes(query)
    )
  })
})

/** Чаты для показа: «Сохранённые сообщения», затем закреплённые, затем остальные. */
const orderedChats = computed<Chat[]>(() => {
  const pinned = new Set(props.pinnedChatIds ?? [])
  const self = filteredChats.value.filter((chat) => chat.is_self)
  const others = filteredChats.value.filter((chat) => !chat.is_self)
  if (pinned.size === 0) return [...self, ...others]
  const top = others.filter((chat) => pinned.has(chat.id))
  const rest = others.filter((chat) => !pinned.has(chat.id))
  return [...self, ...top, ...rest]
})

const filteredContacts = computed<SearchUserResult[]>(() => {
  const query = contactsQuery.value.trim().toLowerCase()
  if (!query) return props.contacts
  return props.contacts.filter((contact) =>
    [contact.username, contact.first_name, contact.last_name, contact.phone_number]
      .filter(Boolean)
      .some((part) => (part as string).toLowerCase().includes(query))
  )
})

const lastMessageIsOut = (chat: Chat): boolean => {
  const last = chat.last_message
  return !!last && props.currentUserId !== null && last.user_id === props.currentUserId
}

const previewText = (chat: Chat): string => {
  const last = chat.last_message
  if (!last) return 'Нет сообщений'
  // Скрытое модерацией: сервер не отдаёт ни текст, ни файл — показываем пометку,
  // а не пустую строку (иначе выглядит как сбой).
  if (last.hidden) return 'Скрыто до проверки модератором'
  if (last.encrypted && isEncryptedPayload(last.text)) return '🔒 Сообщение'
  const me = props.currentUserId
  const mine = me !== null && last.user_id === me
  let prefix = mine ? 'Вы: ' : ''
  if (!mine && isGroupChat(chat)) {
    const author = chat.users.find((user) => user.id === last.user_id)
    if (author) prefix = `${displayName(author)}: `
  }
  const body = last.file ? mediaTypeLabel(last.file) : last.text
  if (last.forwarded_from) return `${prefix}↪ Переслано: ${body}`
  return `${prefix}${body}`
}

const toggleSettingsMenu = () => {
  settingsMenuOpen.value = !settingsMenuOpen.value
}

const runSettingsAction = (action: SettingsAction) => {
  settingsMenuOpen.value = false
  if (action.key === 'group') emit('create-group')
  if (action.key === 'blocked') emit('open-blocked')
  if (action.key === 'reports') emit('open-reports')
  if (action.key === 'appearance') emit('open-appearance')
}

const searchOpen = ref(false)

/** Открыть глобальный поиск (прячет верхний хидер, фокус в поле). */
const openSearch = () => {
  settingsMenuOpen.value = false
  searchOpen.value = true
  requestAnimationFrame(() => searchInputRef.value?.focus())
}

/** Закрыть глобальный поиск и сбросить запрос. */
const closeSearch = () => {
  searchOpen.value = false
  searchQuery.value = ''
  userResults.value = []
  messageResults.value = []
  searching.value = false
  searchError.value = ''
}

const selectChat = (chatId: number) => {
  settingsMenuOpen.value = false
  emit('select-chat', chatId)
}

/** Открытие приватного чата с найденным по поиску пользователем. */
const openChatWithUser = async (user: SearchUserResult) => {
  searchError.value = ''
  try {
    const chat = await openPrivateChat(user.id)
    closeSearch()
    settingsMenuOpen.value = false
    emit('chat-opened', chat)
  } catch (error) {
    searchError.value = getErrorMessage(error, 'Не удалось начать переписку')
  }
}

const setSearchMode = (mode: 'people' | 'messages') => {
  searchMode.value = mode
}

/** Чат, в котором лежит найденное сообщение. */
const chatOfMessage = (message: Message): Chat | undefined =>
  props.chats.find((chat) => chat.id === message.chat_id)

/** Название чата для результата поиска по сообщениям. */
const messageChatTitle = (message: Message): string => {
  const chat = chatOfMessage(message)
  return chat ? chatTitle(chat, props.currentUserId) : `#${message.chat_id}`
}

/** Аватар чата (собеседника) для результата поиска. */
const messageChatAvatar = (message: Message): string | undefined => {
  const chat = chatOfMessage(message)
  return chat ? chatAvatarOf(chat) : undefined
}

/** Префикс «Вы: » для своих сообщений в результате поиска. */
const messageSenderPrefix = (message: Message): string =>
  props.currentUserId !== null && message.user_id === props.currentUserId ? 'Вы: ' : ''

/** Текст сниппета сообщения (текст или тип вложения). */
const messageSnippetText = (message: Message): string => {
  if (message.hidden) return 'Скрыто до проверки модератором'
  if (message.encrypted && isEncryptedPayload(message.text)) return '🔒 Сообщение'
  if (message.text) return message.text
  return message.file ? mediaTypeLabel(message.file) : ''
}

/** Переход к найденному сообщению в его чате. */
const openMessageResult = (message: Message) => {
  closeSearch()
  settingsMenuOpen.value = false
  emit('open-message', message.chat_id, message.id)
}

/** Открытие приватного чата из вкладки «Контакты». */
const openChatWithContact = async (contact: SearchUserResult) => {
  searchError.value = ''
  try {
    const chat = await openPrivateChat(contact.id)
    settingsMenuOpen.value = false
    emit('chat-opened', chat)
  } catch (error) {
    // Ошибка показывается только на вкладке «Чаты» (как в исходном Messenger).
    searchError.value = getErrorMessage(error, 'Не удалось начать переписку')
  }
}

// ---------- Импорт контактов из телефонной книги ----------
const phoneImportOpen = ref(false)
const phoneBusy = ref(false)
const phoneError = ref('')
const manualPhones = ref('')
const phoneMatched = ref<SearchUserResult[] | null>(null)

interface NativePhoneContact {
  name?: string | string[]
  tel?: string[]
}
interface NavigatorWithContacts extends Navigator {
  contacts?: {
    select(props: string[], options: { multiple: boolean }): Promise<NativePhoneContact[]>
  }
}

/** Поддерживает ли браузер системный выбор контактов (Android Chrome/Edge, PWA). */
const phoneContactsSupported = computed<boolean>(() => {
  const nav = navigator as NavigatorWithContacts
  return typeof nav.contacts?.select === 'function'
})

const openPhoneImport = () => {
  phoneImportOpen.value = true
  phoneError.value = ''
  phoneMatched.value = null
  manualPhones.value = ''
}

const closePhoneImport = () => {
  if (phoneBusy.value) return
  phoneImportOpen.value = false
}

const normalizePhone = (raw: string): string => raw.replace(/\D/g, '')

/** Запускает поиск пользователей по номерам. */
const runPhoneMatch = async (phones: string[]) => {
  phoneError.value = ''
  const clean = phones.map(normalizePhone).filter((p) => p.length >= 7)
  if (clean.length === 0) {
    phoneError.value = 'Не удалось определить номера. Проверьте ввод.'
    phoneMatched.value = []
    return
  }
  phoneBusy.value = true
  try {
    phoneMatched.value = await matchUsersByPhone(clean)
  } catch (error) {
    phoneError.value = getErrorMessage(error, 'Не удалось найти в мессенджере')
  } finally {
    phoneBusy.value = false
  }
}

/** Выбор контактов из системной книги. */
const pickDeviceContacts = async () => {
  const nav = navigator as NavigatorWithContacts
  if (!nav.contacts) return
  phoneBusy.value = true
  phoneError.value = ''
  try {
    const contacts = await nav.contacts.select(['tel', 'name'], { multiple: true })
    const phones = contacts.flatMap((c) => c.tel ?? [])
    await runPhoneMatch(phones)
  } catch (error) {
    const err = error as { name?: string }
    // Отмена выбора — не ошибка.
    if (err?.name && err.name !== 'NotAllowedError') {
      phoneError.value = getErrorMessage(error, 'Не удалось открыть контакты')
    }
  } finally {
    phoneBusy.value = false
  }
}

/** Убирает результаты импорта из книги (крестик). */
const clearPhoneMatch = () => {
  phoneMatched.value = null
  phoneError.value = ''
}

/**
 * «Добавить из контактов телефона»: сразу открываем системную книгу,
 * без промежуточного окна. Результаты показываем прямо в списке контактов.
 * Если браузер не умеет открывать книгу (десктоп) — вставка номеров вручную.
 */
const onAddFromPhone = () => {
  phoneError.value = ''
  phoneMatched.value = null
  if (phoneContactsSupported.value) {
    void pickDeviceContacts()
  } else {
    openPhoneImport()
  }
}

/** Поиск по вставленным вручную номерам. */
const findByManualPhones = () => {
  const lines = manualPhones.value.split(/[\n,;]+/)
  void runPhoneMatch(lines)
}

/** Открыть чат с пользователем, найденным по номеру. */
const openPhoneMatch = async (user: SearchUserResult) => {
  phoneImportOpen.value = false
  phoneMatched.value = null
  phoneError.value = ''
  await openChatWithContact(user)
}

// Закрываем «⋯» и глобальный поиск при смене вкладки или выбранного чата извне.
watch([() => props.view, () => props.selectedChatId], () => {
  settingsMenuOpen.value = false
  if (searchOpen.value) closeSearch()
})

let searchTimer: number | null = null
watch([searchQuery, searchMode], ([value, mode]) => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  searchError.value = ''
  const query = value.trim()
  if (!query) {
    userResults.value = []
    messageResults.value = []
    searching.value = false
    return
  }
  searching.value = true
  searchTimer = window.setTimeout(async () => {
    try {
      if (mode === 'messages') {
        messageResults.value = await searchMessages(query)
        userResults.value = []
      } else {
        userResults.value = await searchUsers(query)
        messageResults.value = []
      }
    } catch (error) {
      searchError.value = getErrorMessage(error, 'Не удалось выполнить поиск')
    } finally {
      searching.value = false
    }
  }, 350)
})

onBeforeUnmount(() => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
})
</script>

<style scoped>
.side-panel {
  width: 100%;
  height: 100%;
  background: #ffffff;
  border-right: 1px solid #e2e6ea;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.icon-btn.open {
  color: var(--ms-accent, #1e9b51);
}

.inline-error {
  color: #d64545;
  font-size: 12px;
  padding: 6px 14px;
  background: #fdecec;
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

/* ---------- Индикатор «в сети» (точка на аватаре личного чата) ---------- */
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
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--ms-accent);
  border: 2px solid var(--ms-surface);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06);
  z-index: 1;
}

/* Индикатор «печатает…» в превью диалога */
.row-sub.typing {
  color: var(--ms-accent);
  font-style: italic;
}

/* ---------- Заголовки панелей ---------- */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #ffffff;
}

.panel-title {
  font-size: 19px;
  font-weight: 600;
  margin: 0;
  color: #1c2733;
}

.panel-header-left,
.panel-header-right {
  display: flex;
  gap: 2px;
}

/* Кнопка «Профиль»: вместо иконки показываем мини-аватар пользователя. */
.self-profile-btn {
  background: none;
  border: none;
  padding: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.self-profile-btn:hover {
  background: var(--ms-hover, #f2f4f6);
}

.self-avatar {
  width: 30px;
  height: 30px;
  font-size: 0.72rem;
}

.panel-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 7px 12px;
  background: #f1f3f5;
  border-radius: 10px;
}

.search-icon {
  color: #8595a2;
  font-size: 0.9rem;
}

.panel-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: #1c2733;
}

/* Глобальный поиск (открывается по значку вместо верхнего хидера) */
.search-head {
  margin: 8px 10px 10px;
  padding: 3px 6px;
  gap: 6px;
}

.search-back,
.search-clear {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
}

.search-head .panel-search-input {
  min-width: 0;
}

.search-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: 48px 24px;
  text-align: center;
  color: var(--ms-muted-2, #93a0ab);
}

.search-hint-icon {
  color: var(--ms-icon-3, #c3cdd4);
}

.search-hint p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
}

/* ---------- Списки ---------- */
.section-label {
  padding: 8px 14px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: #8295a3;
  user-select: none;
}

.search-mode-tabs {
  display: flex;
  gap: 6px;
  padding: 2px 14px 8px;
}

.search-mode-tab {
  flex: 1;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #fff);
  color: var(--ms-muted, #71808d);
  border-radius: 10px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.12s;
}

.search-mode-tab:hover {
  background: var(--ms-hover, #f2f4f6);
}

.search-mode-tab.active {
  border-color: var(--ms-accent, #2ea25e);
  color: var(--ms-accent, #2ea25e);
  background: var(--ms-accent-soft, #e3f2e5);
}

.msg-result-chat {
  color: var(--ms-accent, #2ea25e);
}

.msg-result-snippet {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-sub.draft {
  color: var(--ms-accent, #2ea25e);
  font-style: italic;
}

/* Действия над чатом теперь только через режим выделения (удержание). */
.chat-row {
  position: relative;
}

/* Индикатор «чат замьючен» рядом со временем */
.row-muted {
  color: var(--ms-muted, #71808d);
  margin-right: 2px;
  vertical-align: -2px;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 6px;
}

.row-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}

.row-item:hover {
  background: #f2f4f6;
}

.row-item.active {
  background: #e3f2e5;
}

.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.row-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row-title {
  font-size: calc(15px * var(--ms-text-scale, 1));
  font-weight: 600;
  color: #141d26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-time {
  font-size: 12px;
  color: #97a5b0;
  flex-shrink: 0;
}

.row-sub {
  font-size: calc(13.5px * var(--ms-text-scale, 1));
  color: #71808d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-sub.preview {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tick {
  font-size: 0.85rem;
  color: #37aee2;
  flex-shrink: 0;
}

.unread-badge {
  background: #43c56a;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  min-width: 20px;
  height: 20px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  flex-shrink: 0;
}

.row-arrow {
  color: #9aa7b2;
  font-size: 0.95rem;
}

.people-results {
  border-bottom: 1px solid #eef0f2;
}

.search-status,
.empty-hint {
  padding: 14px;
  color: #93a0ab;
  font-size: 13.5px;
  text-align: center;
}

/* Dropdown-меню «⋯» */
.ms-dropdown-wrap {
  position: relative;
  display: inline-flex;
}

.ms-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: #ffffff;
  border: 1px solid #e2e6ea;
  border-radius: 12px;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.16);
  padding: 6px;
  z-index: 120;
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
  color: #1c2733;
  white-space: nowrap;
}

.ms-dropdown-item:hover {
  background: #f2f4f6;
}

.ms-dropdown-item i {
  width: 18px;
  text-align: center;
  font-size: 1rem;
  color: #5b6b79;
}

.ms-dropdown-item .q-icon {
  width: 18px;
  text-align: center;
  color: #5b6b79;
}

/* Нижний отступ под «плавающие» жесты (safe-area) на мобильных. */
.chat-scroll {
  padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
}

/* ---------- Режим выделения чатов (вход по удержанию) ---------- */
.selection-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #ffffff);
}

.selection-count {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.selection-actions .icon-btn.danger {
  color: var(--ms-danger, #d64545);
}

/* Кружок-чекбокс слева в строке чата при выделении. */
.row-selector {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: 2px solid var(--ms-muted, #93a0ab);
  border-radius: 50%;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
}

.row-selector.on {
  background: var(--ms-accent, #2ea25e);
  border-color: var(--ms-accent, #2ea25e);
}

.row-item.selected {
  background: var(--ms-accent-soft, #e3f2e5);
}

/* ---------- Импорт контактов телефона ---------- */
.phone-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(15, 20, 26, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-family: var(--ms-font);
}

.phone-card {
  width: min(440px, 100%);
  max-height: min(680px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #1c2733);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}

.phone-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 6px;
}

.phone-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ms-text-strong, #141d26);
}

.phone-title .q-icon {
  color: var(--ms-accent, #2ea25e);
}

.phone-xbtn {
  background: none;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-icon, #52626f);
  cursor: pointer;
}

.phone-xbtn:hover {
  background: var(--ms-hover, #f2f4f6);
  color: var(--ms-text-strong, #141d26);
}

.phone-body {
  padding: 8px 16px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.phone-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 12px;
  padding: 11px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: var(--ms-accent, #2ea25e);
  color: #fff;
}

.phone-primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.phone-hint {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
}

.phone-or {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  color: var(--ms-muted, #93a0ab);
  font-size: 12px;
}

.phone-or::before,
.phone-or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--ms-border, #e2e6ea);
}

.phone-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
  margin-bottom: 5px;
}

.phone-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
  border-radius: 10px;
  padding: 9px 11px;
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
}

.phone-textarea:focus {
  border-color: var(--ms-accent, #2ea25e);
  background: var(--ms-surface, #ffffff);
}

.phone-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.phone-btn {
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.phone-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.phone-btn.ghost {
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
}

.phone-btn.primary {
  background: var(--ms-accent, #2ea25e);
  color: #fff;
}

.phone-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--ms-danger, #d64545);
}

.phone-result-title {
  margin: 14px 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
}

.phone-empty {
  padding: 12px 4px;
  font-size: 13.5px;
  color: var(--ms-muted, #71808d);
}

.phone-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.phone-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 12px;
  padding: 8px 10px;
  cursor: pointer;
  color: inherit;
}

.phone-row:hover {
  background: var(--ms-hover, #f2f4f6);
}

.phone-row .avatar {
  width: 40px;
  height: 40px;
}

.phone-row-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.phone-row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text-strong, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.phone-row-phone {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.phone-row-icon {
  color: var(--ms-accent, #2ea25e);
  flex: none;
}

/* Встроенные результаты импорта из телефонной книги (без промежуточного окна) */
.phone-inline {
  padding: 4px 12px 6px;
  border-top: 1px solid var(--ms-border, #eef1f3);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.phone-inline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 2px 2px;
}

.phone-inline-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 50%;
  color: var(--ms-muted, #71808d);
  cursor: pointer;
}

.phone-inline-clear:hover {
  background: var(--ms-hover, #eef1f4);
}

.phone-inline-list {
  overflow-y: auto;
  max-height: 34vh;
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.phone-inline .row-item {
  border-radius: 10px;
}

.phone-inline .phone-result-title {
  margin: 0;
}
</style>
