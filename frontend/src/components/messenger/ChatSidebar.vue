<template>
  <aside ref="rootEl" class="side-panel">
    <!-- Диалоги -->
    <template v-if="view === 'chats'">
      <div class="panel-header">
        <div class="panel-header-left">
          <button class="icon-btn" title="Контакты" @click="emit('to-contacts')">
            <i class="pi pi-user-plus"></i>
          </button>
        </div>
        <h2 class="panel-title">Чаты</h2>
        <div class="panel-header-right">
          <button class="icon-btn" title="Новое сообщение" @click="focusSearch">
            <i class="pi pi-pencil"></i>
          </button>
          <span class="ms-dropdown-wrap" @click.stop>
            <button
              class="icon-btn"
              :class="{ open: settingsMenuOpen }"
              title="Настройки"
              @click="toggleSettingsMenu"
            >
              <i class="pi pi-ellipsis-v"></i>
            </button>
            <div v-if="settingsMenuOpen" class="ms-dropdown">
              <button
                v-for="action in SETTINGS_ACTIONS"
                :key="action.key"
                class="ms-dropdown-item"
                @click="runSettingsAction(action)"
              >
                <i :class="action.icon"></i>
                <span>{{ action.label }}</span>
              </button>
            </div>
          </span>
        </div>
      </div>

      <div class="panel-search">
        <i class="pi pi-search search-icon"></i>
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          class="panel-search-input"
          type="text"
          placeholder="Поиск"
          aria-label="Поиск людей"
        />
      </div>

      <div v-if="searchError" class="inline-error">{{ searchError }}</div>

      <!-- Результаты поиска людей -->
      <div v-if="searchQuery.trim()" class="people-results">
        <div v-if="searching" class="search-status">Поиск…</div>
        <template v-else-if="userResults.length">
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
            <i class="pi pi-comment row-arrow"></i>
          </button>
        </template>
        <div v-else class="search-status">Никого не найдено</div>
      </div>

      <div v-if="loadingChats" class="search-status">Загрузка…</div>

      <!-- Недавние диалоги -->
      <template v-else>
        <div class="section-label">Недавние</div>
        <div v-if="!filteredChats.length" class="empty-hint">
          Найдите пользователя по логину или телефону и начните переписку
        </div>
        <div class="chat-scroll">
          <button
            v-for="chat in filteredChats"
            :key="chat.id"
            class="row-item"
            :class="{ active: selectedChatId === chat.id }"
            @click="selectChat(chat.id)"
          >
            <span class="avatar" :style="avatarStyle(chatTitleOf(chat))">
              <img
                v-if="avatarUrlOf(chatPeerOf(chat))"
                :src="avatarUrlOf(chatPeerOf(chat))"
                class="avatar-img"
                alt=""
              />
              <template v-else>{{ initials(chatTitleOf(chat)) }}</template>
            </span>
            <span class="row-text">
              <span class="row-line">
                <span class="row-title">{{ chatTitleOf(chat) }}</span>
                <span class="row-time">
                  {{ chat.last_message ? formatChatTime(chat.last_message.timestamp) : '' }}
                </span>
              </span>
              <span class="row-line">
                <span class="row-sub preview">
                  <i v-if="lastMessageIsOut(chat)" class="pi pi-check tick"></i>
                  {{ previewText(chat) }}
                </span>
                <span v-if="chat.unread_count > 0" class="unread-badge">
                  {{ chat.unread_count }}
                </span>
              </span>
            </span>
          </button>
        </div>
      </template>
    </template>

    <!-- Контакты -->
    <template v-else>
      <div class="panel-header">
        <div class="panel-header-left">
          <button class="icon-btn" title="Назад к чатам" @click="emit('to-chats')">
            <i class="pi pi-arrow-left"></i>
          </button>
        </div>
        <h2 class="panel-title">Контакты</h2>
        <div class="panel-header-right">
          <span class="ms-dropdown-wrap" @click.stop>
            <button
              class="icon-btn"
              :class="{ open: settingsMenuOpen }"
              title="Настройки"
              @click="toggleSettingsMenu"
            >
              <i class="pi pi-ellipsis-v"></i>
            </button>
            <div v-if="settingsMenuOpen" class="ms-dropdown">
              <button
                v-for="action in SETTINGS_ACTIONS"
                :key="action.key"
                class="ms-dropdown-item"
                @click="runSettingsAction(action)"
              >
                <i :class="action.icon"></i>
                <span>{{ action.label }}</span>
              </button>
            </div>
          </span>
        </div>
      </div>

      <div class="panel-search">
        <i class="pi pi-search search-icon"></i>
        <input
          v-model="contactsQuery"
          class="panel-search-input"
          type="text"
          placeholder="Поиск по логину или телефону"
          aria-label="Поиск контактов"
        />
      </div>

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
              }}<template v-if="contact.phone_number"> · {{ contact.phone_number }}</template></span
            >
          </span>
          <i class="pi pi-comment row-arrow"></i>
        </button>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getErrorMessage } from '@/services/errors'
import { openPrivateChat, searchUsers, type SearchUserResult } from '@/services/chatService'
import type { Chat } from '@/types'
import {
  avatarStyle,
  avatarUrlOf,
  chatPeer,
  chatPeerTitle,
  displayName,
  initials
} from '@/utils/user'
import { formatChatTime } from '@/utils/format'
import { mediaTypeLabel } from '@/utils/media'

const props = defineProps<{
  view: 'chats' | 'contacts'
  currentUserId: number | null
  chats: Chat[]
  contacts: SearchUserResult[]
  selectedChatId: number | null
  loadingChats: boolean
  contactsLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'to-contacts'): void
  (e: 'to-chats'): void
  (e: 'open-profile'): void
  (e: 'open-appearance'): void
  (e: 'select-chat', chatId: number): void
  (e: 'chat-opened', chat: Chat): void
}>()

// Пункты верхнего меню «⋯» (сюда будут добавляться новые настройки).
const SETTINGS_ACTIONS = [
  { key: 'profile', label: 'Настройки профиля', icon: 'pi pi-user' },
  { key: 'appearance', label: 'Оформление и тема', icon: 'pi pi-palette' }
] as const

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
const userResults = ref<SearchUserResult[]>([])
const searchError = ref('')
const contactsQuery = ref('')

const searchInputRef = ref<HTMLInputElement | null>(null)

const chatPeerOf = (chat: Chat) => chatPeer(chat, props.currentUserId)
const chatTitleOf = (chat: Chat): string => chatPeerTitle(chat, props.currentUserId)

const filteredChats = computed<Chat[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.chats
  return props.chats.filter((chat) => {
    const peer = chatPeerOf(chat)
    const title = peer ? displayName(peer) : chat.name
    const phone = peer?.phone_number ?? ''
    return (
      title.toLowerCase().includes(query) ||
      chat.name.toLowerCase().includes(query) ||
      phone.toLowerCase().includes(query)
    )
  })
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
  const prefix = props.currentUserId !== null && last.user_id === props.currentUserId ? 'Вы: ' : ''
  const body = last.file ? mediaTypeLabel(last.file) : last.text
  if (last.forwarded_from) return `${prefix}↪ Переслано: ${body}`
  return `${prefix}${body}`
}

const toggleSettingsMenu = () => {
  settingsMenuOpen.value = !settingsMenuOpen.value
}

const runSettingsAction = (action: (typeof SETTINGS_ACTIONS)[number]) => {
  settingsMenuOpen.value = false
  if (action.key === 'profile') emit('open-profile')
  else if (action.key === 'appearance') emit('open-appearance')
}

const focusSearch = () => {
  settingsMenuOpen.value = false
  // Небольшая задержка, чтобы закрытие меню не съело фокус.
  requestAnimationFrame(() => searchInputRef.value?.focus())
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
    searchQuery.value = ''
    userResults.value = []
    settingsMenuOpen.value = false
    emit('chat-opened', chat)
  } catch (error) {
    searchError.value = getErrorMessage(error, 'Не удалось начать переписку')
  }
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

// Закрываем «⋯» при смене вкладки или выбранного чата извне.
watch([() => props.view, () => props.selectedChatId], () => {
  settingsMenuOpen.value = false
})

let searchTimer: number | null = null
watch(searchQuery, (value) => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  searchError.value = ''
  const query = value.trim()
  if (!query) {
    userResults.value = []
    searching.value = false
    return
  }
  searching.value = true
  searchTimer = window.setTimeout(async () => {
    try {
      userResults.value = await searchUsers(query)
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
  width: 320px;
  background: #ffffff;
  border-right: 1px solid #e2e6ea;
  display: flex;
  flex-direction: column;
  min-height: 0;
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
  font-size: 15px;
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
  font-size: 13.5px;
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

@media (max-width: 820px) {
  .side-panel {
    width: 84px;
  }

  .side-panel .panel-title,
  .side-panel .row-text,
  .side-panel .panel-search,
  .side-panel .section-label,
  .side-panel .search-status,
  .side-panel .empty-hint {
    display: none;
  }

  .row-item {
    justify-content: center;
    padding: 8px;
  }
}
</style>
