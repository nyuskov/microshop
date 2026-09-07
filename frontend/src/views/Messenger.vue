<template>
  <div class="messenger-shell">
    <div class="messenger-body">
      <!-- ======= Левая панель ======= -->
      <aside class="side-panel">
        <!-- Диалоги -->
        <template v-if="view === 'chats'">
          <div class="panel-header">
            <div class="panel-header-left">
              <button class="icon-btn" title="Контакты" @click="view = 'contacts'">
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
                @click="startChat(user)"
              >
                <span class="avatar" :style="avatarStyle(displayName(user))">
                  <img v-if="avatarSrc(user)" :src="avatarSrc(user)" class="avatar-img" alt="" />
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
                <span class="avatar" :style="avatarStyle(chatTitle(chat))">
                  <img
                    v-if="avatarSrc(otherUserOfChat(chat))"
                    :src="avatarSrc(otherUserOfChat(chat))"
                    class="avatar-img"
                    alt=""
                  />
                  <template v-else>{{ initials(chatTitle(chat)) }}</template>
                </span>
                <span class="row-text">
                  <span class="row-line">
                    <span class="row-title">{{ chatTitle(chat) }}</span>
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
              <button class="icon-btn" title="Назад к чатам" @click="view = 'chats'">
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
                  v-if="avatarSrc(contact)"
                  :src="avatarSrc(contact)"
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
              <i class="pi pi-comment row-arrow"></i>
            </button>
          </div>
        </template>
      </aside>

      <!-- ======= Правая область чата ======= -->
      <main class="chat-panel" :style="chatBgStyle">
        <template v-if="!selectedChat">
          <div class="chat-placeholder">
            <i class="pi pi-comments placeholder-icon"></i>
            <h3>Выберите, кому хотели бы написать</h3>
            <p>Начните переписку: найдите собеседника по логину или телефону.</p>
            <button class="ghost-btn" @click="view = 'contacts'">Открыть контакты</button>
          </div>
        </template>

        <template v-else>
          <!-- Шапка чата -->
          <div class="chat-header">
            <button class="icon-btn back-btn" title="Контакты" @click="view = 'contacts'">
              <i class="pi pi-arrow-left"></i>
            </button>
            <span class="avatar chat-avatar" :style="avatarStyle(chatTitle(selectedChat))">
              <img
                v-if="avatarSrc(otherUserOfChat(selectedChat))"
                :src="avatarSrc(otherUserOfChat(selectedChat))"
                class="avatar-img"
                alt=""
              />
              <template v-else>{{ initials(chatTitle(selectedChat)) }}</template>
            </span>
            <div class="chat-header-info">
              <div class="chat-title-row">
                <div class="chat-title">{{ chatTitle(selectedChat) }}</div>
                <span v-if="peerStatus(selectedChat)" class="chat-status-pill">
                  {{ peerStatus(selectedChat) }}
                </span>
              </div>
              <div class="chat-subtitle">{{ chatSubtitle(selectedChat) }}</div>
            </div>
            <div class="chat-header-actions">
              <span v-if="isPrivateChat(selectedChat)" class="call-group" @click.stop>
                <button
                  class="icon-btn call-btn"
                  :class="{ holding: callHolding }"
                  :title="
                    callLabel(callKind) + ' — нажмите для звонка, удерживайте 0,5 с для смены типа'
                  "
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
              <button class="icon-btn" title="Поиск по сообщениям" @click="toggleInlineSearch">
                <i class="pi pi-search"></i>
              </button>
              <button class="icon-btn" title="Профиль" @click="goToProfile">
                <span class="avatar mini" :style="avatarStyle(selfName)">
                  <img
                    v-if="avatarSrc(authStore.current_user)"
                    :src="avatarSrc(authStore.current_user)"
                    class="avatar-img"
                    alt=""
                  />
                  <template v-else>{{ selfInitial }}</template>
                </span>
              </button>
            </div>
          </div>

          <!-- Поиск по сообщениям -->
          <div v-if="inlineSearchOpen" class="inline-search">
            <i class="pi pi-search search-icon"></i>
            <input
              v-model="inlineQuery"
              class="inline-search-input"
              type="text"
              placeholder="Поиск по сообщениям"
              aria-label="Поиск по сообщениям"
            />
            <span v-if="serverMatchCount > 0" class="inline-search-count">
              {{ serverMatchCount }} совп.
            </span>
            <button class="icon-btn" @click="toggleInlineSearch">
              <i class="pi pi-times"></i>
            </button>
          </div>

          <!-- Закреплённые сообщения -->
          <div v-if="pinnedMessages.length" class="pinned-bar" @click="closePopups">
            <i class="pi pi-bookmark pinned-icon"></i>
            <div class="pinned-content">
              <div class="pinned-head">
                <span>Закреплённые сообщения</span>
                <span class="pinned-count">{{ pinnedMessages.length }}</span>
              </div>
              <div v-if="pinnedOpen" class="pinned-list">
                <div
                  v-for="message in pinnedMessages"
                  :key="message.id"
                  class="pinned-item"
                  role="button"
                  tabindex="0"
                  title="Перейти к сообщению"
                  @click.stop="scrollToPinnedMessage(message.id)"
                  @keydown.enter.prevent="scrollToPinnedMessage(message.id)"
                  @keydown.space.prevent="scrollToPinnedMessage(message.id)"
                >
                  <span class="pinned-sender">{{ senderName(message) }}</span>
                  {{ pinnedSnippet(message) }}
                </div>
              </div>
            </div>
            <button class="icon-btn" title="Развернуть" @click.stop="pinnedOpen = !pinnedOpen">
              <i class="pi pi-chevron-down" :class="{ rotated: pinnedOpen }"></i>
            </button>
          </div>

          <!-- Сообщения -->
          <div
            ref="messagesContainerRef"
            class="messages-scroll"
            @click="closePopups"
            @scroll.passive="onMessagesScroll"
          >
            <div v-if="messagesLoading" class="chat-status">Загрузка сообщений…</div>
            <template v-else>
              <template
                v-for="(row, index) in messageRows"
                :key="row.kind === 'day' ? 'd' + index : row.message.id"
              >
                <div v-if="row.kind === 'day'" class="day-divider">
                  <span>{{ row.label }}</span>
                </div>
                <div
                  v-else
                  class="msg"
                  :class="[
                    isOwnMessage(row.message) ? 'out' : 'in',
                    { 'msg-highlight': highlightedMessageId === row.message.id }
                  ]"
                  :data-message-id="row.message.id"
                >
                  <div
                    class="msg-bubble"
                    :class="{ 'round-video-only': isRoundVideoOnly(row.message) }"
                  >
                    <!-- Ответ-цитата -->
                    <div
                      v-if="row.message.reply_to_id && replyMessage(row.message)"
                      class="reply-quote"
                      @click.stop="quoteClick(row.message.reply_to_id)"
                    >
                      <span class="quote-name" :class="quoteNameClass(row.message)">
                        {{ quoteName(row.message) }}
                      </span>
                      <span class="quote-text">{{ quoteText(row.message) }}</span>
                    </div>

                    <!-- Вложение -->
                    <template v-if="row.message.file">
                      <a
                        v-if="isImageFile(row.message.file)"
                        class="attachment"
                        :href="mediaAbsolute(row.message.file.url)"
                        :download="row.message.file.name"
                        target="_blank"
                        rel="noopener"
                      >
                        <img
                          :src="mediaAbsolute(row.message.file.url)"
                          :alt="row.message.file.name"
                          class="attachment-image"
                          loading="lazy"
                        />
                      </a>
                      <RoundVideoMessage
                        v-else-if="isRecordedVideoMessage(row.message.file)"
                        :src="mediaAbsolute(row.message.file.url)"
                        :name="row.message.file.name"
                        :size="row.message.file.size"
                      />
                      <video
                        v-else-if="isVideoFile(row.message.file)"
                        class="attachment-video"
                        :src="mediaAbsolute(row.message.file.url)"
                        controls
                        preload="metadata"
                        @click.stop
                      ></video>
                      <AudioMessage
                        v-else-if="isAudioFile(row.message.file)"
                        :src="mediaAbsolute(row.message.file.url)"
                        :name="row.message.file.name"
                        :size="row.message.file.size"
                      />
                      <a
                        v-else
                        class="attachment"
                        :href="mediaAbsolute(row.message.file.url)"
                        :download="row.message.file.name"
                        target="_blank"
                        rel="noopener"
                      >
                        <span class="attachment-card">
                          <i :class="fileIcon(row.message.file)"></i>
                          <span class="attachment-info">
                            <span class="attachment-name">{{ row.message.file.name }}</span>
                            <span class="attachment-meta">{{
                              formatBytes(row.message.file.size)
                            }}</span>
                          </span>
                        </span>
                      </a>
                    </template>

                    <span v-if="row.message.text" class="msg-text">{{ row.message.text }}</span>

                    <span class="msg-meta">
                      <span v-if="row.message.edited_at" class="msg-edited" title="изменено">
                        изменено
                      </span>
                      <span class="msg-time">{{ formatMsgTime(row.message.timestamp) }}</span>
                      <span
                        v-if="isOwnMessage(row.message)"
                        class="msg-ticks"
                        :class="{ read: row.message.is_read }"
                        >✓✓</span
                      >
                    </span>
                  </div>

                  <!-- Реакции -->
                  <div v-if="row.message.reactions.length" class="reactions" @click.stop>
                    <button
                      v-for="reaction in row.message.reactions"
                      :key="reaction.emoji"
                      class="reaction-chip"
                      :class="{ mine: reaction.reacted_by_me }"
                      @click="toggleReaction(row.message, reaction.emoji)"
                    >
                      {{ reaction.emoji }}<span class="reaction-count">{{ reaction.count }}</span>
                    </button>
                  </div>

                  <!-- Действия при наведении -->
                  <div class="msg-actions" @click.stop>
                    <button class="round-btn" title="Ответить" @click="setReply(row.message)">
                      <i class="pi pi-reply"></i>
                    </button>
                    <button
                      class="round-btn"
                      title="Реакция"
                      @click="toggleEmojiPicker(row.message.id)"
                    >
                      <i class="pi pi-face-smile"></i>
                    </button>
                    <button
                      v-if="!row.message.is_pinned"
                      class="round-btn"
                      title="Закрепить"
                      @click="togglePinMessage(row.message)"
                    >
                      <i class="pi pi-bookmark"></i>
                    </button>
                    <button
                      v-else
                      class="round-btn"
                      title="Открепить"
                      @click="togglePinMessage(row.message)"
                    >
                      <i class="pi pi-bookmark-fill"></i>
                    </button>
                    <button class="round-btn" title="Копировать" @click="copyMessage(row.message)">
                      <i class="pi pi-copy"></i>
                    </button>
                    <button
                      v-if="isOwnMessage(row.message) && row.message.text"
                      class="round-btn"
                      title="Редактировать"
                      @click="startEditMessage(row.message)"
                    >
                      <i class="pi pi-pencil"></i>
                    </button>
                    <button class="round-btn" title="Переслать" @click="openForward(row.message)">
                      <i class="pi pi-share-alt"></i>
                    </button>
                    <button
                      v-if="isOwnMessage(row.message)"
                      class="round-btn danger"
                      title="Удалить"
                      @click="deleteMessageOf(row.message)"
                    >
                      <i class="pi pi-trash"></i>
                    </button>
                  </div>

                  <!-- Выбор эмодзи-реакции -->
                  <div v-if="emojiPickerFor === row.message.id" class="emoji-picker" @click.stop>
                    <button
                      v-for="emoji in REACTION_EMOJIS"
                      :key="emoji"
                      class="emoji-option"
                      :class="{ active: hasMyReaction(row.message, emoji) }"
                      @click="toggleReaction(row.message, emoji)"
                    >
                      {{ emoji }}
                    </button>
                  </div>
                </div>
              </template>
              <div v-if="!messageRows.length" class="chat-status">
                Сообщений пока нет. Напишите первым!
              </div>
            </template>
          </div>

          <!-- Панель ввода -->
          <div class="input-area">
            <div v-if="sendError" class="inline-error">{{ sendError }}</div>

            <!-- Редактирование сообщения -->
            <div v-if="editingMessage" class="reply-bar mode-bar">
              <div class="reply-bar-info">
                <span class="reply-bar-name">Редактирование</span>
                <span class="reply-bar-text">{{ editingMessage.text }}</span>
              </div>
              <button class="icon-btn" title="Отмена" @click="cancelEditing">
                <i class="pi pi-times"></i>
              </button>
            </div>

            <!-- Пересылка сообщения -->
            <div v-else-if="forwardSource" class="reply-bar mode-bar forward-bar">
              <span class="reply-bar-name">Переслать:</span>
              <select v-model.number="forwardChatId" class="forward-chat-select">
                <option
                  v-for="chat in chats"
                  :key="chat.id"
                  :value="chat.id"
                  :disabled="chat.id === selectedChatId"
                >
                  {{ chatTitle(chat) }}
                </option>
              </select>
              <button
                class="round-btn"
                title="Переслать"
                :disabled="forwardChatId === null"
                @click="sendForward"
              >
                <i class="pi pi-send"></i>
              </button>
              <button class="icon-btn" title="Отмена" @click="cancelForward">
                <i class="pi pi-times"></i>
              </button>
            </div>

            <!-- Цитата ответа -->
            <div v-if="replyTarget" class="reply-bar">
              <div class="reply-bar-info">
                <span class="reply-bar-name">{{ quoteName(replyTarget) }}</span>
                <span class="reply-bar-text">{{ messageSnippet(replyTarget) }}</span>
              </div>
              <button class="icon-btn" title="Отменить ответ" @click="clearReply">
                <i class="pi pi-times"></i>
              </button>
            </div>

            <VoiceRecorderBar v-if="voiceRecOpen" @cancel="onVoiceCancel" @send="onVoiceSend" />
            <div v-else class="input-row">
              <button class="round-btn" title="Прикрепить файл" @click="attachInput?.click()">
                <i class="pi pi-paperclip"></i>
              </button>
              <input
                ref="attachInput"
                class="hidden-file"
                type="file"
                aria-label="Прикрепить файл"
                @change="onFileSelected"
              />
              <input
                v-model="newMessage"
                class="text-input"
                type="text"
                placeholder="Сообщение"
                aria-label="Сообщение"
                @keydown.enter.prevent="sendText"
              />
              <button class="round-btn" title="Эмодзи" @click="toggleEmojiMenu">
                <i class="pi pi-face-smile"></i>
              </button>
              <button
                class="round-btn gif-btn"
                :class="{ active: gifPanelOpen }"
                title="GIF"
                @click="toggleGifPanel"
              >
                GIF
              </button>
              <span class="mic-wrap">
                <button
                  class="round-btn mic-hold-btn"
                  :class="{
                    holding: micHolding,
                    'mode-video': recordMode === 'video'
                  }"
                  :title="
                    recordMode === 'video'
                      ? 'Видеосообщение (нажмите). Удерживайте 2 секунды — голосовое'
                      : 'Голосовое сообщение (нажмите). Удерживайте 2 секунды — видеосообщение'
                  "
                  :aria-label="
                    recordMode === 'video'
                      ? 'Записать видеосообщение. Удерживайте 2 секунды для голосового'
                      : 'Записать голосовое сообщение. Удерживайте 2 секунды для видеосообщения'
                  "
                  @click="onMicClick"
                  @pointerdown="onMicDown"
                  @pointerup="onMicUp"
                  @pointerleave="onMicUp"
                  @pointercancel="onMicCancel"
                  @contextmenu.prevent
                >
                  <i :class="recordMode === 'video' ? 'pi pi-video' : 'pi pi-microphone'"></i>
                </button>
                <span v-if="recordModeHint" class="record-mode-hint">{{ recordModeHint }}</span>
              </span>
              <button
                v-if="newMessage.trim()"
                class="send-btn"
                title="Отправить"
                :disabled="sending"
                @click="sendText"
              >
                <i class="pi pi-send"></i>
              </button>

              <template v-if="gifPanelOpen && selectedChatId !== null">
                <GifPicker
                  :chat-id="selectedChatId"
                  :reply-to-id="replyTarget?.id ?? null"
                  @sent="onGifSent"
                />
              </template>

              <div v-if="emojiMenuOpen" class="emoji-picker bottom">
                <button
                  v-for="emoji in INPUT_EMOJIS"
                  :key="emoji"
                  class="emoji-option"
                  @click="appendEmoji(emoji)"
                >
                  {{ emoji }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </main>
    </div>
  </div>

  <!-- Profile Modal -->
  <Dialog
    v-model:visible="showProfileModal"
    header="Настройки профиля"
    :modal="true"
    :closable="true"
    :style="{ width: '680px' }"
    @hide="showProfileModal = false"
  >
    <Suspense>
      <template #default>
        <UserProfile @close-modal="showProfileModal = false" />
      </template>
      <template #fallback>
        <div>Загрузка профиля...</div>
      </template>
    </Suspense>
  </Dialog>

  <!-- Appearance Modal -->
  <Dialog
    v-model:visible="showAppearanceModal"
    header="Оформление"
    :modal="true"
    :closable="true"
    :style="{ width: '430px' }"
    @hide="showAppearanceModal = false"
  >
    <AppearanceSettings />
  </Dialog>

  <!-- Login Modal -->
  <LoginModal :visible="showLoginModal" @close-modal="onLoginModalClose" />

  <!-- Звонки -->
  <CallOverlay />

  <!-- Запись видеосообщения -->
  <VideoRecorderModal v-if="videoRecOpen" @close="onVideoCancel" @send="onVideoSend" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import Dialog from 'primevue/dialog'
import LoginModal from '@/components/LoginModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { getErrorMessage } from '@/services/errors'
import {
  fetchContacts,
  fetchMessages,
  fetchMyChats,
  fetchPinnedMessages,
  mediaUrl,
  openPrivateChat,
  removeMessageReaction,
  searchMessages,
  searchUsers,
  editMessage,
  forwardMessage,
  sendAttachmentMessage,
  sendNewMessage,
  setMessagePinned,
  setMessageReaction,
  deleteMessage,
  type SearchUserResult
} from '@/services/chatService'
import type { Chat, ChatUser, Message } from '@/types'
import { avatarStyle, displayName, initials } from '@/utils/user'
import { formatBytes, formatChatTime, formatMsgTime, lastSeenLabel } from '@/utils/format'
import { buildMessageRows, type MessageRow } from '@/utils/thread'
import { useCallButton } from '@/composables/useCallButton'
import { usePeerActivity } from '@/composables/usePeerActivity'
import { useRealtimeSync } from '@/composables/useRealtimeSync'
import { useRecordButton } from '@/composables/useRecordButton'
import {
  fileIcon,
  isAudioFile,
  isImageFile,
  isRecordedVideoMessage,
  isRoundVideoOnly,
  isVideoFile,
  mediaTypeLabel,
  messageSnippet
} from '@/utils/media'
import UserProfile from './UserProfile.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import CallOverlay from '@/components/calls/CallOverlay.vue'
import AudioMessage from '@/components/media/AudioMessage.vue'
import GifPicker from '@/components/media/GifPicker.vue'
import RoundVideoMessage from '@/components/media/RoundVideoMessage.vue'
import VoiceRecorderBar from '@/components/media/VoiceRecorderBar.vue'
import VideoRecorderModal from '@/components/media/VideoRecorderModal.vue'
import { useCallStore } from '@/stores/call'
import { useRealtimeStore } from '@/stores/realtime'
import { mediaFileName, type RecordedMedia } from '@/services/recorder'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const callStore = useCallStore()
const realtimeStore = useRealtimeStore()

// ---------- Модальные окна ----------
const showProfileModal = ref(false)
const showAppearanceModal = ref(false)
const showLoginModal = ref(true)
const voiceRecOpen = ref(false)
const videoRecOpen = ref(false)
const settingsMenuOpen = ref(false)

// ---------- Данные ----------
const view = ref<'chats' | 'contacts'>('chats')
const chats = ref<Chat[]>([])
const messages = ref<Message[]>([])
const pinnedMessages = ref<Message[]>([])
const contacts = ref<SearchUserResult[]>([])
const loadingChats = ref(false)
const messagesLoading = ref(false)
const contactsLoading = ref(false)
const selectedChatId = ref<number | null>(null)

const newMessage = ref('')
const sending = ref(false)
const sendingFile = ref(false)
const sendError = ref('')

const searchQuery = ref('')
const searching = ref(false)
const userResults = ref<SearchUserResult[]>([])
const searchError = ref('')
const contactsQuery = ref('')

const replyTarget = ref<Message | null>(null)
const inlineSearchOpen = ref(false)
const inlineQuery = ref('')
const emojiPickerFor = ref<number | null>(null)
const emojiMenuOpen = ref(false)
const gifPanelOpen = ref(false)
const pinnedOpen = ref(true)
const highlightedMessageId = ref<number | null>(null)
let highlightTimer: number | undefined

const messagesContainerRef = ref<HTMLElement | null>(null)
const attachInput = ref<HTMLInputElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '👏', '🎉']
const INPUT_EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '😍', '😎', '🤔', '👍', '👎', '❤️', '🔥']

// ---------- Фон окна сообщений (обои берутся из store оформления) ----------
const chatBgStyle = computed(() => ({ background: themeStore.wallpaperCss }))

// ---------- Вычисляемые значения ----------
const currentUserId = computed<number | null>(() => authStore.current_user?.id ?? null)
const selfName = computed<string>(() =>
  authStore.current_user ? displayName(authStore.current_user) : ''
)
const selfInitial = computed<string>(() =>
  authStore.current_user ? initials(displayName(authStore.current_user)) : 'U'
)

const avatarSrc = (user: { avatar_url?: string | null } | null | undefined): string | undefined =>
  user?.avatar_url ? mediaUrl(user.avatar_url) : undefined

const selectedChat = computed<Chat | null>(() => {
  if (selectedChatId.value === null) return null
  return chats.value.find((chat) => chat.id === selectedChatId.value) ?? null
})

const filteredChats = computed<Chat[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return chats.value
  return chats.value.filter((chat) => {
    const other = otherUserOfChat(chat)
    const title = other ? displayName(other) : chat.name
    const phone = other?.phone_number ?? ''
    return (
      title.toLowerCase().includes(query) ||
      chat.name.toLowerCase().includes(query) ||
      phone.toLowerCase().includes(query)
    )
  })
})

const filteredContacts = computed<SearchUserResult[]>(() => {
  const query = contactsQuery.value.trim().toLowerCase()
  if (!query) return contacts.value
  return contacts.value.filter((contact) =>
    [contact.username, contact.first_name, contact.last_name, contact.phone_number]
      .filter(Boolean)
      .some((part) => (part as string).toLowerCase().includes(query))
  )
})

const messageRows = computed<MessageRow[]>(() =>
  buildMessageRows(messages.value, inlineQuery.value)
)

// ---------- Вспомогательные функции ----------
const otherUserOfChat = (chat: Chat): ChatUser | undefined => {
  if (currentUserId.value !== null) {
    const found = chat.users.find((user) => user.id !== currentUserId.value)
    if (found) return found
  }
  return chat.users[0]
}

/** Находит пользователя по id среди участников чатов или списка контактов. */
const findPeerUser = (
  id: number
):
  | {
      username: string
      first_name?: string | null
      last_name?: string | null
      avatar_url?: string | null
    }
  | undefined => {
  for (const chat of chats.value) {
    const other = otherUserOfChat(chat)
    if (other && other.id === id) return other
  }
  return contacts.value.find((contact) => contact.id === id)
}

const isPrivateChat = (chat: Chat | null): boolean => !!chat && chat.users.length === 2

const startVoiceCall = () => {
  const chat = selectedChat.value
  if (!isPrivateChat(chat)) return
  const peer = otherUserOfChat(chat as Chat)
  if (!peer) return
  void callStore.startCall(
    { id: peer.id, name: displayName(peer), avatarUrl: peer.avatar_url ?? null },
    'audio'
  )
}

const startVideoCall = () => {
  const chat = selectedChat.value
  if (!isPrivateChat(chat)) return
  const peer = otherUserOfChat(chat as Chat)
  if (!peer) return
  void callStore.startCall(
    { id: peer.id, name: displayName(peer), avatarUrl: peer.avatar_url ?? null },
    'video'
  )
}

// ---------- Звонок в шапке чата: клик = звонок, удержание 0,5 c = смена типа ----------
const { callKind, callHolding, callLabel, onCallDown, onCallUp, onCallCancel, onCallClick } =
  useCallButton({
    onTap: () => {
      closeMenus()
      if (callKind.value === 'video') startVideoCall()
      else startVoiceCall()
    }
  })

const chatTitle = (chat: Chat): string => {
  const other = otherUserOfChat(chat)
  return other ? displayName(other) : chat.name
}

/** Задаваемый собеседником текст-статус (для шапки личного чата). */
const peerStatus = (chat: Chat): string => {
  const other = otherUserOfChat(chat)
  if (!other || !isPrivateChat(chat)) return ''
  return (other.status ?? '').trim()
}

const isOwnMessage = (message: Message): boolean =>
  currentUserId.value !== null && message.user_id === currentUserId.value

const lastMessageIsOut = (chat: Chat): boolean => {
  const last = chat.last_message
  return !!last && currentUserId.value !== null && last.user_id === currentUserId.value
}

const previewText = (chat: Chat): string => {
  const last = chat.last_message
  if (!last) return 'Нет сообщений'
  const prefix = currentUserId.value !== null && last.user_id === currentUserId.value ? 'Вы: ' : ''
  if (last.file) {
    return `${prefix}${mediaTypeLabel(last.file)}`
  }
  return `${prefix}${last.text}`
}

const senderName = (message: Message): string => (isOwnMessage(message) ? 'Вы' : chatTitleSafe())

function chatTitleSafe(): string {
  return selectedChat.value ? chatTitle(selectedChat.value) : ''
}

const replyMessage = (message: Message): Message | undefined =>
  message.reply_to_id != null
    ? messages.value.find((item) => item.id === message.reply_to_id)
    : undefined

const quoteName = (message: Message): string => {
  const target = replyMessage(message)
  if (!target) return 'Сообщение'
  return isOwnMessage(target) ? 'Вы' : 'Собеседник'
}

const quoteNameClass = (message: Message): Record<string, boolean> => ({
  mine: (() => {
    const target = replyMessage(message)
    return !!target && isOwnMessage(target)
  })()
})

const quoteText = (message: Message): string => {
  const target = replyMessage(message)
  return target ? messageSnippet(target) : ''
}

const quoteClick = (_messageId: number) => {
  emojiPickerFor.value = null
  // Просто закрываем всплывающие меню (без реальной прокрутки здесь)
}

const senderNameOfMessage = (message: Message): string => {
  const other = otherUserOfChatForMessage(message)
  return other ? displayName(other) : 'Собеседник'
}

const otherUserOfChatForMessage = (message: Message): ChatUser | undefined => {
  const chat = chats.value.find((item) => item.id === message.chat_id)
  if (!chat) return undefined
  const other = otherUserOfChat(chat)
  if (other && other.id === message.user_id) return other
  return other
}

const pinnedSnippet = (message: Message): string =>
  `${message.user_id === currentUserId.value ? 'Вы: ' : senderNameOfMessage(message) + ': '}${messageSnippet(message)}`

// ---------- Присутствие + индикатор «печатает…» (состояние в composable) ----------
const {
  peerPresence,
  isWithinOnlineWindow,
  applyPresence,
  isPeerTyping,
  markPeerTyping,
  clearPeerTyping,
  clearAll
} = usePeerActivity({
  isMe: (userId) => userId === currentUserId.value
})

/** Подмешивает присутствие из свежего ответа /chats (не перетирая WS-статус). */
const syncPresenceFromChats = (list: Chat[]) => {
  for (const chat of list) {
    const other = otherUserOfChat(chat)
    if (!other) continue
    const known = peerPresence[other.id]
    if (known?.online) continue
    peerPresence[other.id] = {
      online: isWithinOnlineWindow(other.last_seen),
      last_seen: other.last_seen ?? null
    }
  }
}

/** Подпись шапки личного чата: присутствие собеседника. */
const presenceText = (chat: Chat): string => {
  const other = otherUserOfChat(chat)
  if (!other) return chat.name
  if (!isPrivateChat(chat)) {
    const parts: string[] = [`@${other.username}`]
    if (other.phone_number) parts.push(other.phone_number)
    return parts.join(' · ')
  }
  const known = peerPresence[other.id]
  if (known?.online) return 'в сети'
  if (known) return known.last_seen ? lastSeenLabel(known.last_seen, false) : 'был(а) давно'
  return lastSeenLabel(other.last_seen) || 'был(а) давно'
}

const chatSubtitle = (chat: Chat): string => {
  if (isPeerTyping(chat.id)) return 'печатает…'
  return presenceText(chat)
}

// ---------- Файлы ----------
const mediaAbsolute = (path: string): string => mediaUrl(path)

// ---------- Реакции ----------
const hasMyReaction = (message: Message, emoji: string): boolean =>
  message.reactions.some((reaction) => reaction.reacted_by_me && reaction.emoji === emoji)

const toggleEmojiPicker = (messageId: number) => {
  emojiPickerFor.value = emojiPickerFor.value === messageId ? null : messageId
}

const closePopups = () => {
  emojiPickerFor.value = null
  emojiMenuOpen.value = false
  gifPanelOpen.value = false
  settingsMenuOpen.value = false
}

const closeMenus = () => {
  settingsMenuOpen.value = false
}

const toggleReaction = async (message: Message, emoji: string) => {
  const mine = hasMyReaction(message, emoji)
  try {
    const updated = mine
      ? await removeMessageReaction(message.id)
      : await setMessageReaction(message.id, emoji)
    emojiPickerFor.value = null
    replaceMessageInThread(updated)
  } catch (error) {
    console.error('Не удалось изменить реакцию:', getErrorMessage(error))
  }
}

// ---------- Загрузка данных ----------
const loadChats = async () => {
  loadingChats.value = true
  try {
    const fresh = await fetchMyChats()
    chats.value = fresh
    syncPresenceFromChats(fresh)
  } catch (error) {
    console.error('Не удалось загрузить чаты:', getErrorMessage(error))
  } finally {
    loadingChats.value = false
  }
}

// ---------- Пагинация истории ----------
const MESSAGES_PAGE_SIZE = 80
const noMoreOlder = ref(false)
const loadingOlder = ref(false)

const isNearBottom = (container: HTMLElement): boolean =>
  container.scrollHeight - container.scrollTop - container.clientHeight < 120

const replaceMessageInThread = (updated: Message) => {
  messages.value = messages.value.map((m) => (m.id === updated.id ? updated : m))
}

const removeMessageFromThread = (messageId: number) => {
  messages.value = messages.value.filter((m) => m.id !== messageId)
}

/** Загружает самую свежую страницу (при открытии чата). */
const loadThreadLatest = async (chatId: number) => {
  messagesLoading.value = true
  noMoreOlder.value = false
  loadingOlder.value = false
  try {
    messages.value = await fetchMessages(chatId, { limit: MESSAGES_PAGE_SIZE })
  } catch (error) {
    console.error('Не удалось загрузить сообщения:', getErrorMessage(error))
  } finally {
    messagesLoading.value = false
  }
}

/**
 * Объединяет свежую «последнюю страницу» с уже загруженными старыми
 * сообщениями (не роняет загруженную выше историю) и при новых сообщениях
 * прокручивает вниз, только если пользователь и так внизу.
 */
const mergeThreadLatest = async (chatId: number): Promise<boolean> => {
  const previousIds = new Set(messages.value.map((m) => m.id))
  const fresh = await fetchMessages(chatId, { limit: MESSAGES_PAGE_SIZE })
  const freshIds = new Set(fresh.map((m) => m.id))
  const keptOlder = messages.value.filter((m) => !freshIds.has(m.id))
  messages.value = [...keptOlder, ...fresh].sort((a, b) => a.id - b.id)
  const hasNew = fresh.some((m) => !previousIds.has(m.id))
  const container = messagesContainerRef.value
  if (hasNew && (!container || isNearBottom(container))) {
    await nextTick()
    scrollToBottom()
  }
  return hasNew
}

/** Подгружает более старые сообщения при прокрутке вверх. */
const loadOlderMessages = async () => {
  const chatId = selectedChatId.value
  const container = messagesContainerRef.value
  if (chatId === null || loadingOlder.value || noMoreOlder.value || messages.value.length === 0) {
    return
  }
  const prevScrollHeight = container?.scrollHeight ?? 0
  const prevScrollTop = container?.scrollTop ?? 0
  const oldestId = messages.value.reduce<number | null>(
    (min, m) => (min === null || m.id < min ? m.id : min),
    null
  )
  loadingOlder.value = true
  try {
    const older = await fetchMessages(chatId, {
      limit: MESSAGES_PAGE_SIZE,
      beforeId: oldestId ?? undefined
    })
    const existingIds = new Set(messages.value.map((m) => m.id))
    const toAdd = older.filter((m) => !existingIds.has(m.id))
    if (older.length === 0 || toAdd.length === 0) {
      noMoreOlder.value = true
      return
    }
    messages.value = [...toAdd, ...messages.value].sort((a, b) => a.id - b.id)
    await nextTick()
    if (container) {
      container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight)
    }
  } catch (error) {
    console.error('Не удалось загрузить более старые сообщения:', getErrorMessage(error))
  } finally {
    loadingOlder.value = false
  }
}

const onMessagesScroll = () => {
  const container = messagesContainerRef.value
  if (container && container.scrollTop < 80) {
    void loadOlderMessages()
  }
}

const loadPinned = async (chatId: number) => {
  try {
    pinnedMessages.value = await fetchPinnedMessages(chatId)
  } catch (error) {
    console.error('Не удалось загрузить закреплённые сообщения:', getErrorMessage(error))
  }
}

const loadContacts = async () => {
  contactsLoading.value = true
  try {
    contacts.value = await fetchContacts()
  } catch (error) {
    console.error('Не удалось загрузить контакты:', getErrorMessage(error))
  } finally {
    contactsLoading.value = false
  }
}

const refreshThread = async () => {
  const chatId = selectedChatId.value
  if (chatId === null) return
  await Promise.all([mergeThreadLatest(chatId), loadPinned(chatId), loadChats()])
}

const scrollToBottom = () => {
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight
  }
}

// ---------- Выбор чата ----------
const selectChat = async (chatId: number) => {
  if (selectedChatId.value === chatId) return
  selectedChatId.value = chatId
  sendError.value = ''
  messages.value = []
  pinnedMessages.value = []
  inlineQuery.value = ''
  inlineSearchOpen.value = false
  clearReply()
  await Promise.all([loadThreadLatest(chatId), loadPinned(chatId)])
  scrollToBottom()
}

const startChat = async (user: SearchUserResult) => {
  searchError.value = ''
  try {
    const chat = await openPrivateChat(user.id)
    upsertChat(chat)
    searchQuery.value = ''
    userResults.value = []
    view.value = 'chats'
    selectedChatId.value = chat.id
    messages.value = []
    pinnedMessages.value = []
    clearReply()
    await Promise.all([loadThreadLatest(chat.id), loadPinned(chat.id)])
    scrollToBottom()
  } catch (error) {
    searchError.value = getErrorMessage(error, 'Не удалось начать переписку')
  }
}

const openChatWithContact = async (contact: SearchUserResult) => {
  view.value = 'chats'
  await startChat(contact)
}

const upsertChat = (chat: Chat) => {
  const index = chats.value.findIndex((item) => item.id === chat.id)
  if (index === -1) {
    chats.value.unshift(chat)
  } else {
    chats.value[index] = chat
  }
}

// ---------- Отправка ----------
const sendText = async () => {
  const chatId = selectedChatId.value
  const text = newMessage.value.trim()
  if (chatId === null || !text || sending.value) return

  sending.value = true
  sendError.value = ''
  try {
    const editing = editingMessage.value
    if (editing) {
      const updated = await editMessage(editing.id, text)
      newMessage.value = ''
      editingMessage.value = null
      replaceMessageInThread(updated)
      sendTypingStop(chatId)
      await loadPinned(chatId)
      scrollToBottom()
      return
    }

    const message = await sendNewMessage(chatId, text, replyTarget.value?.id)
    newMessage.value = ''
    sendTypingStop(chatId)
    clearReply()
    await refreshThread()
    messages.value = appendMessage(messages.value, message)
    await loadPinned(chatId)
    scrollToBottom()
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось отправить сообщение')
  } finally {
    sending.value = false
  }
}

const appendMessage = (list: Message[], message: Message): Message[] => {
  if (list.some((item) => item.id === message.id)) return list
  return [...list, message]
}

const onFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const chatId = selectedChatId.value
  if (chatId === null) return

  sendingFile.value = true
  sendError.value = ''
  try {
    const message = await sendAttachmentMessage(
      chatId,
      file,
      newMessage.value.trim(),
      replyTarget.value?.id
    )
    newMessage.value = ''
    clearReply()
    sendTypingStop(chatId)
    messages.value = appendMessage(messages.value, message)
    await loadPinned(chatId)
    await loadChats()
    scrollToBottom()
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось отправить файл')
  } finally {
    sendingFile.value = false
  }
}

// ---------- Запись аудио/видеосообщений ----------
const openVoiceRec = () => {
  closePopups()
  voiceRecOpen.value = true
}

const onVoiceCancel = () => {
  voiceRecOpen.value = false
}

const onVoiceSend = async (payload: RecordedMedia) => {
  voiceRecOpen.value = false
  await uploadRecordedMedia(payload, 'voice')
}

const openVideoRec = () => {
  closePopups()
  videoRecOpen.value = true
}

const onVideoCancel = () => {
  videoRecOpen.value = false
  resetRecordMode()
}

const onVideoSend = async (payload: RecordedMedia) => {
  videoRecOpen.value = false
  resetRecordMode()
  await uploadRecordedMedia(payload, 'video')
}

const uploadRecordedMedia = async (payload: RecordedMedia, kind: 'voice' | 'video') => {
  const chatId = selectedChatId.value
  if (chatId === null) return
  sendingFile.value = true
  sendError.value = ''
  try {
    const file = new File([payload.blob], mediaFileName(kind, payload.mime), {
      type: payload.mime
    })
    const message = await sendAttachmentMessage(chatId, file, '', replyTarget.value?.id)
    clearReply()
    sendTypingStop(chatId)
    messages.value = appendMessage(messages.value, message)
    await Promise.all([loadPinned(chatId), loadChats()])
    scrollToBottom()
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось отправить медиасообщение')
  } finally {
    sendingFile.value = false
  }
}

// ---------- Одна кнопка аудио/видео (состояние в composable) ----------
const {
  recordMode,
  micHolding,
  recordModeHint,
  onMicDown,
  onMicUp,
  onMicCancel,
  onMicClick,
  resetRecordMode
} = useRecordButton({
  isRecording: () => voiceRecOpen.value || videoRecOpen.value,
  onRecord: (mode) => {
    if (mode === 'video') openVideoRec()
    else openVoiceRec()
  }
})

// ---------- Ответ (reply) ----------
const setReply = (message: Message) => {
  replyTarget.value = message
  emojiPickerFor.value = null
}

const clearReply = () => {
  replyTarget.value = null
}

// ---------- Действия над сообщением ----------
const togglePinMessage = async (message: Message) => {
  try {
    const updated = await setMessagePinned(message.id, !message.is_pinned)
    replaceMessageInThread(updated)
    const chatId = selectedChatId.value
    if (chatId !== null) {
      await loadPinned(chatId)
    }
  } catch (error) {
    console.error('Не удалось изменить закрепление:', getErrorMessage(error))
  }
}

const copyMessage = async (message: Message) => {
  try {
    await navigator.clipboard.writeText(message.text || '')
  } catch (error) {
    console.error('Не удалось скопировать:', getErrorMessage(error))
  }
}

// ---------- Редактирование / пересылка ----------
const editingMessage = ref<Message | null>(null)
const forwardSource = ref<Message | null>(null)
const forwardChatId = ref<number | null>(null)

const startEditMessage = (message: Message) => {
  if (!isOwnMessage(message)) return
  clearReply()
  forwardSource.value = null
  forwardChatId.value = null
  editingMessage.value = message
  newMessage.value = message.text || ''
}

const cancelEditing = () => {
  editingMessage.value = null
  newMessage.value = ''
}

const openForward = (message: Message) => {
  cancelEditing()
  forwardSource.value = message
  forwardChatId.value =
    chats.value.find((chat) => chat.id !== selectedChatId.value)?.id ?? chats.value[0]?.id ?? null
}

const cancelForward = () => {
  forwardSource.value = null
  forwardChatId.value = null
}

const sendForward = async () => {
  const source = forwardSource.value
  const targetChatId = forwardChatId.value
  if (!source || targetChatId === null) return
  try {
    const sent = await forwardMessage(source.id, targetChatId)
    cancelForward()
    sendTypingStop(targetChatId)
    if (selectedChatId.value === targetChatId) {
      messages.value = appendMessage(messages.value, sent)
      await loadPinned(targetChatId)
    } else {
      await loadChats()
    }
  } catch (error) {
    console.error('Не удалось переслать сообщение:', getErrorMessage(error))
  }
}

const deleteMessageOf = async (message: Message) => {
  if (!window.confirm('Удалить это сообщение?')) return
  try {
    await deleteMessage(message.id)
    removeMessageFromThread(message.id)
    const chatId = selectedChatId.value
    if (chatId !== null) {
      await Promise.all([loadPinned(chatId), loadChats()])
    }
  } catch (error) {
    console.error('Не удалось удалить сообщение:', getErrorMessage(error))
  }
}

// ---------- Переход к закреплённому сообщению ----------
const scrollToPinnedMessage = async (messageId: number) => {
  // Если активен поиск по сообщениям — снимаем фильтр, иначе сообщения может не быть в ленте.
  if (inlineSearchOpen.value) {
    inlineSearchOpen.value = false
    inlineQuery.value = ''
  }
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
  highlightedMessageId.value = messageId
  await nextTick()
  const container = messagesContainerRef.value
  if (container) {
    const el = container.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
    if (el) {
      const containerRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      container.scrollTop +=
        elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2
    }
  }
  highlightTimer = window.setTimeout(() => {
    highlightedMessageId.value = null
  }, 2400)
}

// ---------- Поиск по сообщениям ----------
const toggleInlineSearch = () => {
  inlineSearchOpen.value = !inlineSearchOpen.value
  closeMenus()
  if (!inlineSearchOpen.value) inlineQuery.value = ''
}

// ---------- Поиск по сообщениям (серверный) ----------
let inlineSearchTimer: number | null = null
const serverMatchCount = ref(0)

const revealMessageInThread = async (messageId: number) => {
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
  highlightedMessageId.value = messageId
  await nextTick()
  const container = messagesContainerRef.value
  const el = container
    ? (container.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null)
    : null
  if (container && el) {
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    container.scrollTop +=
      elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2
  }
  highlightTimer = window.setTimeout(() => {
    highlightedMessageId.value = null
  }, 2400)
}

/** Серверный поиск по всей истории + догрузка старых до найденного. */
const runInlineServerSearch = async () => {
  const chatId = selectedChatId.value
  const query = inlineQuery.value.trim()
  if (!query || chatId === null) {
    serverMatchCount.value = 0
    return
  }
  const results = await searchMessages(query, chatId)
  serverMatchCount.value = results.length
  if (results.length === 0) return

  // Результаты приходят по возрастанию: первый — самый старый.
  const oldestNeeded = results[0].id
  const minLoaded = messages.value.length ? Math.min(...messages.value.map((m) => m.id)) : null
  if (minLoaded !== null && minLoaded <= oldestNeeded) {
    await revealMessageInThread(results[results.length - 1].id)
    return
  }
  // Догружаем более старые, пока не накроем самый старый результат.
  for (let i = 0; i < 20 && !noMoreOlder.value; i += 1) {
    await loadOlderMessages()
    const nextMin = messages.value.length ? Math.min(...messages.value.map((m) => m.id)) : null
    if (nextMin !== null && nextMin <= oldestNeeded) break
  }
  const newest = results[results.length - 1]
  if (messages.value.some((m) => m.id === newest.id)) {
    await revealMessageInThread(newest.id)
  }
}

watch(inlineQuery, (value) => {
  if (inlineSearchTimer !== null) {
    window.clearTimeout(inlineSearchTimer)
    inlineSearchTimer = null
  }
  if (!value.trim() || selectedChatId.value === null) {
    serverMatchCount.value = 0
    return
  }
  inlineSearchTimer = window.setTimeout(() => {
    inlineSearchTimer = null
    void runInlineServerSearch().catch((error) => {
      console.error('Не удалось выполнить поиск по сообщениям:', getErrorMessage(error))
    })
  }, 350)
})

// ---------- Эмодзи / GIF в поле ввода ----------
const appendEmoji = (emoji: string) => {
  newMessage.value = `${newMessage.value}${emoji}`
  emojiMenuOpen.value = false
}

const toggleEmojiMenu = () => {
  emojiMenuOpen.value = !emojiMenuOpen.value
  gifPanelOpen.value = false
}

const toggleGifPanel = () => {
  gifPanelOpen.value = !gifPanelOpen.value
  emojiMenuOpen.value = false
}

const onGifSent = async (message: Message) => {
  gifPanelOpen.value = false
  clearReply()
  messages.value = appendMessage(messages.value, message)
  const chatId = selectedChatId.value
  if (chatId !== null) {
    sendTypingStop(chatId)
    await Promise.all([loadPinned(chatId), loadChats()])
    scrollToBottom()
  }
}

// ---------- Поиск людей ----------
const focusSearch = () => {
  closeMenus()
  nextTick(() => searchInputRef.value?.focus())
}

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

// ---------- События реального времени (WS-канал) вместо поллинга ----------
// Сервер пушит события, по которым делаем выборочный refetch. Редкий
// «страховочный» опрос остаётся на случай пропущенных событий/реконнекта.
const refreshChatsQuiet = async () => {
  if (!authStore.isAuthenticated) return
  try {
    const fresh = await fetchMyChats()
    chats.value = fresh
    syncPresenceFromChats(fresh)
  } catch (error) {
    console.error('Не удалось обновить чаты:', getErrorMessage(error))
  }
}

const refreshOpenThreadQuiet = async () => {
  const chatId = selectedChatId.value
  if (chatId === null) return
  try {
    await mergeThreadLatest(chatId)
    const pinned = await fetchPinnedMessages(chatId)
    const pinnedChanged =
      pinned.map((item) => item.id).join(',') !==
      pinnedMessages.value.map((item) => item.id).join(',')
    if (pinnedChanged) pinnedMessages.value = pinned
  } catch (error) {
    console.error('Не удалось обновить сообщения:', getErrorMessage(error))
  }
}

// Оркестрация (таймеры/события) вынесена в composable.
const { start: startRealtime, stop: stopRealtime } = useRealtimeSync({
  isAuthenticated: () => authStore.isAuthenticated,
  isMe: (userId) => userId === currentUserId.value,
  getSelectedChatId: () => selectedChatId.value,
  onPresence: applyPresence,
  onTyping: markPeerTyping,
  onTypingStop: clearPeerTyping,
  onChatsSync: refreshChatsQuiet,
  onThreadSync: refreshOpenThreadQuiet
})

// ---------- Отправка индикатора «печатает…» ----------
const TYPING_SEND_INTERVAL_MS = 3000
let lastTypingSentAt = 0

const sendTypingStop = (chatId: number) => {
  realtimeStore.send({ type: 'typing-stop', chat_id: chatId })
}

// Пока пользователь набирает текст — с троттлингом сообщаем собеседнику.
watch(newMessage, (value) => {
  const chatId = selectedChatId.value
  if (!value.trim() || chatId === null) return
  const now = Date.now()
  if (now - lastTypingSentAt >= TYPING_SEND_INTERVAL_MS) {
    lastTypingSentAt = now
    realtimeStore.send({ type: 'typing', chat_id: chatId })
  }
})

// ---------- Навигация ----------
// Пункты верхнего меню «⋯» (сюда будут добавляться новые настройки).
const SETTINGS_ACTIONS = [
  { key: 'profile', label: 'Настройки профиля', icon: 'pi pi-user' },
  { key: 'appearance', label: 'Оформление и тема', icon: 'pi pi-palette' }
] as const

const toggleSettingsMenu = () => {
  settingsMenuOpen.value = !settingsMenuOpen.value
}

const runSettingsAction = (action: (typeof SETTINGS_ACTIONS)[number]) => {
  closeMenus()
  if (action.key === 'profile') goToProfile()
  else if (action.key === 'appearance') openAppearance()
}

const goToProfile = () => {
  showProfileModal.value = true
  closeMenus()
}

const openAppearance = () => {
  showAppearanceModal.value = true
  closeMenus()
}

const onLoginModalClose = () => {
  console.log('Login modal close event received. Closing modal.')
  showLoginModal.value = false
}

// ---------- Жизненный цикл ----------
const ready = computed(() => authStore.isAuthenticated && currentUserId.value !== null)

watch(
  ready,
  async (isReady) => {
    if (isReady) {
      await Promise.all([loadChats(), loadContacts()])
      startRealtime()
      void callStore.connect()
    } else {
      stopRealtime()
      callStore.disconnect()
      chats.value = []
      messages.value = []
      pinnedMessages.value = []
      contacts.value = []
      userResults.value = []
      selectedChatId.value = null
      clearAll()
    }
  },
  { immediate: true }
)

onMounted(async () => {
  await authStore.initializeApp()
  scrollToBottom()
})

onBeforeUnmount(() => {
  stopRealtime()
  realtimeStore.setHandler(null)
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
  }
  if (inlineSearchTimer !== null) {
    window.clearTimeout(inlineSearchTimer)
    inlineSearchTimer = null
  }
})

watch(
  () => authStore.isAuthenticated,
  (isAuthenticated) => {
    showLoginModal.value = !isAuthenticated
  },
  { immediate: true }
)

// Обогащаем карточку собеседника (имя/аватар) при звонке из списка чатов/контактов.
watch(
  [() => callStore.status, () => callStore.peerId],
  ([status, peerId]) => {
    if (status === 'idle' || peerId === null) return
    const peer = findPeerUser(peerId)
    if (peer) {
      callStore.setPeerInfo({
        name: displayName(peer),
        avatarUrl: peer.avatar_url ?? null
      })
    }
  },
  { immediate: true }
)

watch(
  selectedChatId,
  (newId, oldId) => {
    if (oldId != null && oldId !== newId) sendTypingStop(oldId)
    closePopups()
    clearReply()
    if (editingMessage.value) cancelEditing()
    if (forwardSource.value) cancelForward()
    voiceRecOpen.value = false
    videoRecOpen.value = false
    resetRecordMode()
    highlightedMessageId.value = null
    if (highlightTimer !== undefined) {
      window.clearTimeout(highlightTimer)
      highlightTimer = undefined
    }
  },
  { immediate: true }
)
</script>

<style scoped>
/* ---------- Каркас ---------- */
.messenger-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #6d7c8c;
  /* Всё «лишнее» (подсказки/кольца анимации) не должно давать полосу прокрутки
     страницы — прокручивается только список сообщений внутри. */
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.messenger-body {
  flex: 1;
  display: flex;
  min-height: 0;
  background: #e7ebf0;
}

.side-panel {
  width: 320px;
  background: #ffffff;
  border-right: 1px solid #e2e6ea;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background-image: radial-gradient(
    circle at 1px 1px,
    rgba(120, 144, 156, 0.12) 1px,
    transparent 0
  );
  background-size: 22px 22px;
  background-color: #eef1f4;
}

/* ---------- Общие элементы ---------- */
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

.round-btn {
  background: none;
  border: none;
  color: #5b6b79;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  cursor: pointer;
  padding: 0;
}

.round-btn:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #1d2731;
}

.round-btn.danger:hover {
  color: #d64545;
}

.round-btn.muted {
  color: #9aa7b2;
}

/* Кнопка открытия панели GIF */
.gif-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.3px;
  color: var(--ms-accent, #2ea25e);
}

.gif-btn.active {
  background: #e3f2e5;
  color: #1e9b51;
}

/* Кнопка записи голосового/видеосообщения (удержание 2 c — переключение режима) */
.mic-wrap {
  position: relative;
  display: inline-flex;
}

.mic-hold-btn {
  position: relative;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.mic-hold-btn.holding,
.mic-hold-btn.mode-video {
  color: #2ea25e;
}

.mic-hold-btn.holding::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid #2ea25e;
  opacity: 0;
  animation: mic-hold-ring 2s ease-out forwards;
  pointer-events: none;
}

/* Подсказка о смене режима */
.record-mode-hint {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 26, 32, 0.85);
  color: #fff;
  padding: 4px 10px;
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  z-index: 12;
  animation: record-hint-pop 0.15s ease-out;
}

@keyframes record-hint-pop {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

@keyframes mic-hold-ring {
  0% {
    opacity: 0.9;
    transform: scale(0.92);
  }
  100% {
    opacity: 0;
    transform: scale(1.6);
  }
}

/* Пузырь, где лежит только кружок-видео */
.msg-bubble.round-video-only {
  background: transparent;
  box-shadow: none;
  padding: 2px;
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

.inline-error {
  color: #d64545;
  font-size: 12px;
  padding: 6px 14px;
  background: #fdecec;
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

/* ---------- Пустое состояние чата ---------- */
.chat-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #7c8a96;
  padding: 24px;
  background: transparent;
}

.placeholder-icon {
  font-size: 4rem;
  color: #b9c6cf;
  margin-bottom: 14px;
}

.chat-placeholder h3 {
  margin: 0 0 6px;
  color: #52626f;
}

.ghost-btn {
  margin-top: 14px;
  border: 1px solid #b9c6cf;
  background: #fff;
  color: #3f7c56;
  padding: 9px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.ghost-btn:hover {
  background: #eef6ef;
}

/* ---------- Шапка чата ---------- */
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

/* ---------- Закреплённые ---------- */
.pinned-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 16px;
  background: #fffdf4;
  border-bottom: 1px solid #efe4c8;
}

.pinned-icon {
  color: #c9a227;
  font-size: 1rem;
  margin-top: 3px;
}

.pinned-content {
  flex: 1;
  min-width: 0;
}

.pinned-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #8a7320;
  font-weight: 600;
}

.pinned-count {
  background: #f3e6b8;
  color: #8a7320;
  border-radius: 10px;
  padding: 0 6px;
  font-size: 11px;
}

.pinned-item {
  font-size: 13.5px;
  color: #4a4a3c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 3px;
  padding: 4px 8px;
  border-radius: 8px;
  cursor: pointer;
}

.pinned-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.pinned-sender {
  font-weight: 600;
  color: #1e7a43;
  margin-right: 6px;
}

/* Подсветка сообщения при переходе из закреплённых */
.msg-highlight .msg-bubble {
  animation: msg-highlight-pulse 2.4s ease 1;
}

@keyframes msg-highlight-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(46, 162, 94, 0);
  }
  15% {
    box-shadow: 0 0 0 3px var(--ms-accent, #2ea25e);
  }
  55% {
    box-shadow: 0 0 0 3px var(--ms-accent, #2ea25e);
  }
}

/* ---------- Сообщения ---------- */
.messages-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
}

.day-divider {
  display: flex;
  justify-content: center;
  margin: 10px 0;
}

.day-divider span {
  background: #ffffff;
  color: #60707c;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.msg {
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 3px 0;
  max-width: 60%;
}

.msg.out {
  align-self: flex-end;
  align-items: flex-end;
}

.msg.in {
  align-self: flex-start;
  align-items: flex-start;
}

.msg-bubble {
  position: relative;
  padding: 7px 11px 6px;
  border-radius: 12px;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1);
  min-width: 70px;
}

.msg.out .msg-bubble {
  background: #dcf8c6;
  border-top-right-radius: 3px;
}

.msg.in .msg-bubble {
  background: #ffffff;
  border-top-left-radius: 3px;
}

.msg-text {
  display: block;
  color: #111;
  font-size: 14.5px;
  line-height: 1.35;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.msg-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  margin-top: 2px;
  line-height: 1;
}

.msg-time {
  font-size: 11px;
  color: #8a98a3;
}

.msg-ticks {
  font-size: 12px;
  color: #99a7b1;
  letter-spacing: -4px; /* галки стоят плотнее друг к другу */
}

.msg-ticks.read {
  color: #3aa6e0;
}

/* Ответ-цитата */
.reply-quote {
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.06);
  border-left: 3px solid #3aa6e0;
  border-radius: 6px;
  padding: 5px 9px;
  margin-bottom: 5px;
  cursor: pointer;
  min-width: 120px;
}

.msg.out .reply-quote {
  border-left-color: #3f9d56;
}

.quote-name {
  font-size: 12.5px;
  font-weight: 700;
  color: #3aa6e0;
}

.quote-name.mine {
  color: #3f9d56;
}

.quote-text {
  font-size: 13px;
  color: #5c6a75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Вложения */
.attachment {
  display: block;
  margin-bottom: 4px;
  text-decoration: none;
}

.attachment-image {
  max-width: 300px;
  max-height: 260px;
  border-radius: 8px;
  display: block;
}

.attachment-video {
  max-width: 320px;
  max-height: 300px;
  border-radius: 8px;
  display: block;
  margin-bottom: 4px;
}

.attachment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f4f6f8;
  border-radius: 8px;
  padding: 8px 12px;
  color: #2f3b44;
}

.attachment-card i {
  font-size: 1.6rem;
  color: #d4585e;
}

.attachment-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.attachment-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #141d26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.attachment-meta {
  font-size: 12px;
  color: #8a98a3;
}

/* Действия при наведении */
.msg-actions {
  position: absolute;
  top: -14px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
  display: flex;
  gap: 2px;
  padding: 2px 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
  z-index: 5;
}

.msg.in .msg-actions {
  left: 4px;
}

.msg.out .msg-actions {
  right: 4px;
}

.msg:hover .msg-actions,
.msg:focus-within .msg-actions {
  opacity: 1;
  pointer-events: auto;
}

.msg-actions .round-btn {
  width: 28px;
  height: 28px;
  font-size: 0.9rem;
}

/* Реакции */
.reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}

.reaction-chip {
  border: 1px solid #e0e4e8;
  background: #ffffff;
  color: #43525d;
  font-size: 13px;
  border-radius: 14px;
  padding: 2px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.reaction-chip.mine {
  background: #d8efdd;
  border-color: #7cc48c;
}

.reaction-count {
  font-size: 11.5px;
  font-weight: 600;
}

/* Палитра эмодзи */
.emoji-picker {
  position: absolute;
  top: -46px;
  background: #ffffff;
  border-radius: 18px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  z-index: 10;
}

.msg.in .emoji-picker {
  left: 4px;
}

.msg.out .emoji-picker {
  right: 4px;
}

.emoji-option {
  background: transparent;
  border: none;
  font-size: 19px;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.emoji-option:hover {
  background: #f0f2f4;
  transform: scale(1.18);
}

.emoji-option.active {
  background: #e3f2e5;
}

.emoji-picker.bottom {
  position: absolute;
  top: auto;
  bottom: 56px;
  right: 14px;
  left: auto;
}

/* Поиск по сообщениям */
.inline-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #ffffff;
  border-bottom: 1px solid #e2e6ea;
}

.inline-search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
}

.inline-search-count {
  flex: none;
  font-size: 12px;
  color: #8a94a6;
  white-space: nowrap;
}

.msg-edited {
  font-size: 11px;
  font-style: italic;
  opacity: 0.75;
  margin-right: 6px;
}

.forward-chat-select {
  max-width: 220px;
  padding: 4px 6px;
  border: 1px solid #d4d9e0;
  border-radius: 8px;
  background: #fff;
  color: inherit;
  font-size: 13px;
}

/* ---------- Ввод ---------- */
.input-area {
  padding: 10px 14px;
  background: #f0f2f5;
  border-top: 1px solid #e2e6ea;
  position: relative;
}

.reply-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border-left: 3px solid #3aa6e0;
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
}

.reply-bar-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.reply-bar-name {
  font-size: 12.5px;
  font-weight: 700;
  color: #3aa6e0;
}

.reply-bar-text {
  font-size: 13px;
  color: #5c6a75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #ffffff;
  border-radius: 12px;
  padding: 5px 10px;
  position: relative;
}

.text-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  background: transparent;
  padding: 7px 4px;
  color: #141d26;
}

.send-btn {
  background: #2ea25e;
  color: #fff;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
}

.send-btn:hover {
  background: #288e52;
}

.hidden-file {
  display: none;
}

.chat-status {
  padding: 12px;
  text-align: center;
  color: #8a98a3;
  font-size: 13.5px;
}

.rotated {
  transform: rotate(180deg);
}

.call-btn {
  color: var(--ms-accent, #2ea25e);
}

.call-btn:hover {
  color: var(--ms-accent, #2ea25e);
}

.call-group {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/* Кнопка звонка: короткое нажатие = звонок, удержание 0,5 c = смена типа */
.call-btn {
  position: relative;
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

.icon-btn.open {
  color: var(--ms-accent, #1e9b51);
}

/* Dropdown-меню (верх панели и звонки в шапке чата) */
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

  .back-btn {
    display: inline-flex;
  }
}
</style>
