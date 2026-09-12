<template>
  <q-layout class="messenger-shell" view="hhh lpr fff">
    <!-- Озвучивание входящих сообщений скринридером (визуально скрыто) -->
    <p class="sr-only" role="status" aria-live="polite">{{ liveAnnouncement }}</p>
    <!-- ======= QDrawer: Чаты / Контакты (десктоп — постоянная панель,
         мобильный — выдвижной drawer поверх чата) ======= -->
    <q-drawer
      v-model="drawerOpen"
      side="left"
      :width="drawerWidth"
      :breakpoint="1023"
      :show-if-above="true"
      :overlay="!isDesktop"
      :no-swipe-open="!isDesktop && selectedChatId !== null"
      :no-swipe-close="!isDesktop && selectedChatId === null"
      bordered
      class="ms-drawer"
    >
      <ChatSidebar
        ref="sidebarRef"
        :view="view"
        :current-user-id="currentUserId"
        :chats="chats"
        :contacts="contacts"
        :selected-chat-id="selectedChatId"
        :loading-chats="loadingChats"
        :contacts-loading="contactsLoading"
        :online-user-ids="onlineUserIds"
        :typing-chat-ids="typingChatIds"
        :pinned-chat-ids="pinnedChatIds"
        :muted-chat-ids="mutedChatIds"
        :drafts="draftsByChatId"
        :self-name="selfName"
        :self-avatar-url="selfAvatarUrl"
        :is-admin="authStore.isAdmin"
        :unread-count="totalUnread"
        @open-message="openGlobalMessage"
        @toggle-pin="toggleChatPinned"
        @toggle-mute="toggleChatMuted"
        @bulk-mute="bulkSetMuted"
        @bulk-pin="bulkSetPinned"
        @bulk-delete="openBulkDeleteChats"
        @delete-chat="openDeleteChatModal"
        @to-contacts="openContacts"
        @to-stories="openStories"
        @open-story="openStory"
        @to-chats="goToChats"
        @open-profile="goToProfile"
        @select-chat="selectChat"
        @chat-opened="onChatOpened"
        @create-group="openCreateGroup"
        @open-blocked="showBlockedUsers = true"
        @open-reports="showReports = true"
      />
    </q-drawer>

    <!-- ======= Правая область чата ======= -->
    <q-page-container class="messenger-page">
      <main class="chat-panel" :style="chatBgStyle">
        <template v-if="!selectedChatId">
          <ChatPlaceholder @open-contacts="openContacts" />
        </template>

        <!-- Чат восстановлен из адреса (`?chat=`), но список чатов ещё грузится:
             показываем загрузку, а не заглушку «выберите чат» — иначе при
             обновлении страницы мелькает экран со списком и заглушкой. -->
        <div v-else-if="!selectedChat" class="chat-restoring">
          <q-spinner size="30px" color="primary" />
          <span>Открываю чат…</span>
        </div>

        <template v-else>
          <!-- Режим выбора сообщений: панель вместо шапки (как в чатах) -->
          <header v-if="msgSelectionMode" class="chat-select-header">
            <button class="icon-btn" title="Выйти из выбора" @click="exitMessageSelection">
              <q-icon :name="icon('close')" size="21px" />
            </button>
            <div class="chat-select-info">
              <span class="chat-select-title">Выбрано: {{ selectedMessageIds.length }}</span>
            </div>
            <div class="chat-select-actions">
              <button
                class="icon-btn"
                :class="{ on: allVisibleMessagesSelected }"
                title="Выбрать все"
                aria-label="Выбрать все"
                @click="toggleSelectAllMessages"
              >
                <q-icon :name="icon('done_all')" size="20px" />
              </button>
              <!-- Действия с сообщением (реакции, ответить, закрепить, удалить,
                   пожаловаться) — кнопки в панели нет: на телефоне меню
                   открывается удержанием выбранного сообщения, на компьютере —
                   наведением/правым щелчком по нему. -->
              <button
                class="icon-btn"
                title="Переслать выбранные"
                aria-label="Переслать выбранные"
                @click="bulkForwardMessages"
              >
                <q-icon :name="icon('forward')" size="20px" />
              </button>
              <button
                class="icon-btn"
                title="Сохранить в «Сохранённые сообщения»"
                aria-label="Сохранить в «Сохранённые сообщения»"
                @click="bulkSaveMessagesToSelf"
              >
                <q-icon :name="icon('bookmark')" size="20px" />
              </button>
              <button
                class="icon-btn danger"
                title="Удалить выбранные"
                aria-label="Удалить выбранные"
                @click="bulkDeleteMessages"
              >
                <q-icon :name="icon('delete')" size="20px" />
              </button>
            </div>
          </header>

          <!-- Шапка чата -->
          <ChatHeader
            v-else
            :chat="selectedChat"
            :current-user-id="currentUserId"
            :subtitle="chatSubtitle(selectedChat)"
            :status-pill="peerStatus(selectedChat)"
            :show-call-button="isPrivateChat(selectedChat)"
            :show-back="!isDesktop"
            :peer-online="selectedChatPeerOnline"
            :pinned="selectedChatPinned"
            :e2ee="selectedChatE2ee"
            @back="goBackToList"
            @toggle-search="toggleInlineSearch"
            @open-info="openChatInfo"
            @start-call="startCall"
            @toggle-pin="toggleCurrentChatPin"
            @report-chat="openReportForPeer"
            @block-chat="blockSelectedPeer"
          />

          <!-- Поиск по сообщениям -->
          <InlineSearchBar
            v-if="inlineSearchOpen"
            v-model:query="inlineQuery"
            :count="serverMatchCount"
            @close="toggleInlineSearch"
          />

          <!-- Закреплённые сообщения -->
          <PinnedBar
            v-if="pinnedRows.length"
            v-model:open="pinnedOpen"
            :rows="pinnedRows"
            @scroll-to="scrollToPinnedMessage"
            @close-popups="closePopups"
          />

          <!-- Сообщения -->
          <MessageThread
            ref="threadRef"
            :rows="messageRows"
            :loading="messagesLoading"
            :current-user-id="currentUserId"
            :highlighted-message-id="highlightedMessageId"
            :emoji-picker-for="emojiPickerFor"
            :quote-of="quoteFor"
            :selection-mode="msgSelectionMode"
            :selected-message-ids="selectedMessageIds"
            :pending="threadPendingRows"
            :is-group-chat="isGroupChat(selectedChat)"
            :members="selectedChat.users"
            :unread-count="unreadAtOpen"
            @retry-pending="retryOutboxItem"
            @drop-pending="dropOutboxItem"
            @background-click="closePopups"
            @reach-top="loadOlderMessages"
            @quote-click="quoteClick"
            @select-start="startMessageSelection"
            @toggle-select="toggleMessageSelect"
            @forwarder-click="openForwarderChat"
            @toggle-emoji-picker="onToggleEmojiPicker"
            @set-reply="setReply"
            @toggle-reaction="toggleReaction"
            @toggle-pin="togglePinMessage"
            @copy="copyMessage"
            @edit="startEditMessage"
            @forward="openForward"
            @save="saveMessageToSelf"
            @delete="deleteMessageOf"
            @report="openReportForMessage"
            @open-image="openImageFromMessage"
          />

          <!-- Примечание E2EE (как в Telegram) над строкой ввода -->
          <div v-if="selectedChatE2ee" class="chat-e2ee-note">
            <q-icon :name="icon('lock')" size="13px" aria-hidden="true" />
            <span>Сообщения защищены сквозным шифрованием</span>
          </div>

          <!-- Панель ввода (композер) -->
          <MessageComposer
            ref="composerRef"
            :chat-id="selectedChat.id"
            v-model:new-message="newMessage"
            :sending="sending"
            :send-error="sendError"
            :reply-target="replyTarget"
            :reply-bar-name="replyBarName"
            :editing-message="editingMessage"
            :extras-panel="extrasPanel"
            :voice-rec-open="voiceRecOpen"
            :mention-members="selectedChat && isGroupChat(selectedChat) ? selectedChat.users : []"
            :record-mode="recordMode"
            :mic-holding="micHolding"
            :record-mode-hint="recordModeHint"
            @send-text="sendText"
            @file-selected="onFileSelected"
            @cancel-edit="cancelEditing"
            @clear-reply="clearReply"
            @voice-cancel="onVoiceCancel"
            @voice-send="onVoiceSend"
            @mic-down="onMicDown"
            @mic-up="onMicUp"
            @mic-cancel="onMicCancel"
            @mic-click="onMicClick"
            @toggle-extras="toggleExtras"
            @set-extras-tab="setExtrasTab"
            @gif-sent="onGifSent"
            @append-emoji="appendEmoji"
          />
        </template>
      </main>
    </q-page-container>
  </q-layout>

  <!-- Пересылка сообщения (список чатов) -->
  <ForwardDialog
    v-if="forwardSource"
    :source="forwardSource"
    :chats="chats"
    :current-user-id="currentUserId"
    :current-chat-id="selectedChatId"
    :sending="forwardBusy"
    @close="cancelForward"
    @forward="sendForward"
  />

  <!-- Содержимое, присланное из системного «Поделиться» Android -->
  <ShareToChatDialog
    v-if="nativeShare"
    :text="nativeShare.text"
    :file-name="nativeShare.name"
    :preview-url="nativeSharePreviewUrl"
    :chats="chats"
    :current-user-id="currentUserId"
    :busy="nativeShareBusy"
    @close="cancelNativeShare"
    @share="sendIncomingShare"
  />

  <!-- Profile Modal (Quasar) -->
  <q-dialog v-model="showProfileModal" @hide="onProfileHidden">
    <q-card class="ms-modal ms-modal-profile">
      <q-card-section class="row no-wrap items-center ms-modal-head">
        <div class="text-subtitle1 text-weight-medium ellipsis">Настройки</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
      </q-card-section>
      <q-separator />
      <q-card-section class="ms-modal-body">
        <Suspense>
          <template #default>
            <UserProfile ref="profileRef" @close-modal="showProfileModal = false" />
          </template>
          <template #fallback>
            <div class="q-pa-md">Загрузка профиля...</div>
          </template>
        </Suspense>
      </q-card-section>
    </q-card>
  </q-dialog>

  <!-- Истории: полноэкранный просмотр -->
  <StoryViewer
    v-if="openStoryId !== null"
    :groups="storiesStore.groups"
    :start-story-id="openStoryId"
    @close="openStoryId = null"
  />

  <!-- Информация о чате -->
  <q-dialog v-model="showChatInfoModal">
    <template v-if="selectedChat && !isGroupChat(selectedChat)">
      <ChatInfo
        :chat="selectedChat"
        :current-user-id="currentUserId"
        :subtitle="chatSubtitle(selectedChat)"
        :messages="messages"
        :e2ee-enabled="!!selectedChat.e2ee_enabled"
        @toggle-e2ee="onChatInfoToggleE2ee"
        @close="showChatInfoModal = false"
        @open-image="openChatInfoImage"
      />
    </template>
  </q-dialog>

  <!-- Информация о группе: состав, роли, настройки -->
  <q-dialog v-model="showGroupInfoModal">
    <template v-if="selectedChat && isGroupChat(selectedChat)">
      <GroupChatInfo
        :chat="selectedChat"
        :current-user-id="currentUserId"
        :contacts="contacts"
        :online-user-ids="onlineUserIds"
        :e2ee-enabled="!!selectedChat.e2ee_enabled"
        @close="showGroupInfoModal = false"
        @updated="onGroupInfoUpdated"
        @left="onGroupLeft"
        @toggle-e2ee="onChatInfoToggleE2ee"
        @members-changed="onGroupMembersChanged"
      />
    </template>
  </q-dialog>

  <!-- Создание группы -->
  <q-dialog v-model="showCreateGroupModal">
    <GroupCreateDialog
      :contacts="contacts"
      @close="showCreateGroupModal = false"
      @created="onGroupCreated"
    />
  </q-dialog>

  <!-- Удаление чата (для себя / для всех) -->
  <q-dialog v-model="showDeleteChatModal">
    <q-card class="delchat-card">
      <q-card-section class="row no-wrap items-center delchat-head">
        <div class="text-subtitle1 text-weight-medium ellipsis">
          {{ deleteChatBulkIds.length ? 'Удалить чаты' : 'Удалить чат' }}
        </div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
      </q-card-section>
      <q-separator />
      <q-card-section class="delchat-body">
        <p class="delchat-text">
          <template v-if="deleteChatBulkIds.length">
            Удалить выбранные чаты ({{ deleteChatBulkIds.length }})?
          </template>
          <template v-else>
            Удалить чат с <b>{{ deleteChatTitle }}</b
            >?
          </template>
        </p>
        <q-radio v-model="deleteChatScope" val="me" label="Только у меня" />
        <div class="delchat-hint">Чат исчезнет из вашего списка; у собеседника останется.</div>
        <q-radio v-model="deleteChatScope" val="all" label="Для всех" />
        <div class="delchat-hint">Чат и переписка будут удалены у всех участников.</div>
      </q-card-section>
      <q-separator />
      <q-card-actions align="right" class="delchat-actions">
        <q-btn flat label="Отмена" v-close-popup />
        <q-btn flat color="negative" label="Удалить" @click="confirmDeleteChat" />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <!-- Login Modal -->
  <LoginModal :visible="showLoginModal" @close-modal="onLoginModalClose" />

  <!-- Модерация: жалоба на контент и список заблокированных (требования RuStore) -->
  <ReportDialog
    v-if="reportTarget"
    :user-id="reportTarget.userId"
    :user-name="reportTarget.userName"
    :chat-id="reportTarget.chatId"
    :message-id="reportTarget.messageId"
    :message-preview="reportTarget.messagePreview"
    @close="reportTarget = null"
    @sent="onReportSent"
  />
  <BlockedUsersDialog
    v-if="showBlockedUsers"
    @close="showBlockedUsers = false"
    @unblocked="onBlockedUsersChanged"
  />
  <!-- Разбор жалоб — только у администраторов (пункт «⋯» появляется им одним) -->
  <ModerationReportsDialog v-if="showReports && authStore.isAdmin" @close="showReports = false" />

  <!-- Новый вход в аккаунт (из push «Это не я» / ?security=1) -->
  <SecurityAlertDialog v-model="showSecurityAlert" />
  <PeerKeyChangedDialog
    v-model="showPeerKeyChanged"
    :peer-name="peerKeyChangedName"
    @accept="acceptChangedPeerKey"
  />

  <!-- Промежуточный экран при запуске из уведомления о звонке.
       Кнопки обе, как у настоящего входящего звонка: раньше здесь была только
       красная кнопка, и человек, открывший приложение кнопкой «Ответить»,
       видел один «сброс» — нажатие на него и выглядело как «принять =
       отклонить». «Ответить» до прихода offer просто ждёт его и отвечает сам. -->
  <Teleport to="body">
    <div v-if="callLaunchScreen === 'ring' && callStore.status === 'idle'" class="call-launch-wait">
      <div class="clw-card">
        <span class="clw-ring" aria-hidden="true"></span>
        <p v-if="callLaunchPeerName" class="clw-peer">{{ callLaunchPeerName }}</p>
        <p class="clw-text">
          {{ callLaunchAnswering ? 'Отвечаем…' : 'Входящий звонок…' }}
        </p>
        <div class="clw-actions">
          <button
            type="button"
            class="clw-answer"
            :aria-label="callLaunchAnswering ? 'Принимаем звонок' : 'Ответить на звонок'"
            :disabled="callLaunchAnswering"
            @click="answerCallLaunch"
          >
            <q-icon :name="icon('call')" size="26px" />
          </button>
          <button
            type="button"
            class="clw-decline"
            aria-label="Отклонить звонок"
            @click="dismissCallLaunch"
          >
            <q-icon :name="icon('call_end')" size="26px" />
          </button>
        </div>
      </div>
    </div>
    <div v-else-if="callLaunchScreen === 'missed'" class="call-launch-wait call-launch-missed">
      <div class="clw-card">
        <p class="clw-text">Вызов завершён</p>
      </div>
    </div>
  </Teleport>

  <!-- Звонки -->
  <CallOverlay />

  <!-- Приглашение в группу по ссылке (`/j/<токен>`): показываем, КУДА зовут,
       и спрашиваем согласие — человек в этой группе ещё не состоит. Карточка в
       отдельном чанке: она нужна только тем, кто открыл ссылку. -->
  <GroupInviteDialog
    v-model="inviteDialogOpen"
    :preview="invitePreview"
    :joining="inviteJoining"
    :error="inviteJoinError"
    @close="closeInviteDialog"
    @join="confirmJoinInvite"
  />

  <!-- Запись видеосообщения -->
  <VideoRecorderModal v-if="videoRecOpen" @close="onVideoCancel" @send="onVideoSend" />

  <!-- Просмотр изображений (lightbox) -->
  <ImageLightbox
    v-if="lightboxItems.length > 0 && lightboxIndex !== null"
    :images="lightboxItems"
    :index="lightboxIndex"
    @close="closeLightbox"
    @prev="lightboxStep(-1)"
    @next="lightboxStep(1)"
  />
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import {
  ref,
  reactive,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
  computed,
  defineAsyncComponent
} from 'vue'
import { Notify, useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import LoginModal from '@/components/LoginModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import {
  addOutboxItem,
  nextOutboxLocalId,
  patchOutboxItem,
  readOutbox,
  removeOutboxItem,
  type OutboxItem
} from '@/utils/outbox'
import { getErrorMessage, isChatGoneError, isNetworkError } from '@/services/errors'
import { isCallStillPending } from '@/services/pendingCall'
import { watchServiceWorkerUpdate } from '@/services/swUpdate'
import { blockUser } from '@/services/moderation'
import {
  fetchMessages,
  fetchMyChats,
  fetchPinnedMessages,
  fetchUserByUsername,
  searchMessages,
  editMessage,
  forwardMessage,
  fetchChatDetail,
  openPrivateChat,
  sendAttachmentMessage,
  sendNewMessage,
  setMessagePinned,
  setMessageReaction,
  removeMessageReaction,
  deleteMessage,
  deleteChat,
  setChatMuted,
  setChatE2ee,
  fetchGroupInvitePreview,
  joinGroupByInvite
} from '@/services/chatService'
import {
  ENCRYPTED_FALLBACK,
  acceptPeerKey,
  bootstrapE2ee,
  chatAesKeyFor,
  decryptText,
  distributeGroupKey,
  e2eeReadyForChat,
  encryptText,
  isE2eeAvailable,
  isEncryptedPayload,
  onPeerKeyChanged,
  resetE2eeSession,
  type PeerKeyChange
} from '@/services/e2ee'
import { encryptFileForChat, parseFileMeta } from '@/services/e2eeFiles'
import {
  decryptedMediaFor,
  preloadDecryptedMedia,
  releaseDecryptedMedia,
  releaseDecryptedMediaExcept
} from '@/composables/useDecryptedMedia'
import type { Chat, ChatUser, EncryptedFileMeta, GroupInvitePreview, Message } from '@/types'
import { avatarUrlOf, chatPeer, chatTitle, displayName, isGroupChat } from '@/utils/user'
import { setAppBadge } from '@/utils/appBadge'
import { usernameFromProfilePath } from '@/utils/profileLink'
import { inviteTokenFromPath } from '@/utils/groupInvite'
import { shareTargetFromSearch, withoutShareTargetParams } from '@/utils/shareTarget'
import { lastSeenLabel } from '@/utils/format'
import { buildMessageRows, type MessageRow as ThreadRow } from '@/utils/thread'
import { effectiveFile, messageSnippet, optimizeImageFile } from '@/utils/media'
import { deleteDraft, fetchDrafts, putDraft } from '@/services/drafts'
import { buildLightboxItems, neighborIndexes } from '@/utils/lightbox'
import { decideBackStep, type Section } from '@/utils/mobileNav'
import { mediaUrl } from '@/config'
import {
  chatIdFromUrl,
  chatUrlWith,
  isReplyLaunch,
  readStoredSection,
  storeSection
} from '@/utils/chatUrl'
import { haptic } from '@/utils/haptics'
import { usePeerActivity } from '@/composables/usePeerActivity'
import { useRealtimeSync } from '@/composables/useRealtimeSync'
import { useRecordButton } from '@/composables/useRecordButton'
import ChatSidebar from '@/components/messenger/ChatSidebar.vue'
import ChatHeader from '@/components/messenger/ChatHeader.vue'
import ChatPlaceholder from '@/components/messenger/ChatPlaceholder.vue'
import InlineSearchBar from '@/components/messenger/InlineSearchBar.vue'
import PinnedBar from '@/components/messenger/PinnedBar.vue'
import MessageThread from '@/components/messenger/MessageThread.vue'
import type { PendingRow } from '@/components/messenger/MessageThread.vue'
import MessageComposer from '@/components/messenger/MessageComposer.vue'

// Тяжёлые модалки/оверлеи подгружаем асинхронно — они нужны только после
// действия пользователя (профиль/оформление/инфо о чате, звонок, лайтбокс,
// видеозапись), это уменьшает стартовый чанк приложения.
const UserProfile = defineAsyncComponent(() => import('./UserProfile.vue'))
const CallOverlay = defineAsyncComponent(() => import('@/components/calls/CallOverlay.vue'))
const ForwardDialog = defineAsyncComponent(() => import('@/components/messenger/ForwardDialog.vue'))
// Приём содержимого из системного «Поделиться» Android (выбор чата).
const ShareToChatDialog = defineAsyncComponent(
  () => import('@/components/messenger/ShareToChatDialog.vue')
)
const ChatInfo = defineAsyncComponent(() => import('@/components/messenger/ChatInfo.vue'))
const GroupCreateDialog = defineAsyncComponent(
  () => import('@/components/messenger/GroupCreateDialog.vue')
)
const GroupChatInfo = defineAsyncComponent(() => import('@/components/messenger/GroupChatInfo.vue'))
const VideoRecorderModal = defineAsyncComponent(
  () => import('@/components/media/VideoRecorderModal.vue')
)
const ImageLightbox = defineAsyncComponent(() => import('@/components/media/ImageLightbox.vue'))
// Карточка приглашения нужна только по ссылке — отдельный чанк.
const GroupInviteDialog = defineAsyncComponent(
  () => import('@/components/messenger/GroupInviteDialog.vue')
)
// Диалоги модерации (требования RuStore): жалоба на контент и список блокировок.
const ReportDialog = defineAsyncComponent(() => import('@/components/messenger/ReportDialog.vue'))
const BlockedUsersDialog = defineAsyncComponent(
  () => import('@/components/messenger/BlockedUsersDialog.vue')
)
// Разбор жалоб — служебный экран только для администраторов.
const ModerationReportsDialog = defineAsyncComponent(
  () => import('@/components/messenger/ModerationReportsDialog.vue')
)
// Просмотрщик историй — открывается по клику на историю.
const StoryViewer = defineAsyncComponent(() => import('@/components/stories/StoryViewer.vue'))
import { useCallStore } from '@/stores/call'
import { useContactsStore } from '@/stores/contacts'
import { useRealtimeStore } from '@/stores/realtime'
import { useStoriesStore } from '@/stores/stories'
import SecurityAlertDialog from '@/components/messenger/SecurityAlertDialog.vue'
import PeerKeyChangedDialog from '@/components/messenger/PeerKeyChangedDialog.vue'
import { mediaFileName, type RecordedMedia } from '@/services/recorder'
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushPermission,
  showIncomingCallRing,
  closeCallRings
} from '@/services/pwa'
import {
  disableNativePush,
  enableNativePush,
  initNativePush,
  isNativeApp
} from '@/services/nativePush'
import {
  MAX_SHARE_FILE_BYTES,
  clearNativeShare,
  initNativeShare,
  readNativeShareFile,
  type NativeShareDescriptor
} from '@/services/nativeShare'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const callStore = useCallStore()
const realtimeStore = useRealtimeStore()

// ---------- Модальные окна ----------
const showProfileModal = ref(false)

/** Открытая история (id) — пока не null, показываем полноэкранный просмотрщик. */
const openStoryId = ref<number | null>(null)
const storiesStore = useStoriesStore()

/** Разделы профиля (см. UserProfile): нужно, чтобы "назад" выходил из раздела. */
interface ProfileHandle {
  isInSection: () => boolean
  backToSections: () => void
}
const profileRef = ref<ProfileHandle | null>(null)
const showChatInfoModal = ref(false)
const showGroupInfoModal = ref(false)
const showCreateGroupModal = ref(false)
const showLoginModal = ref(true)
// Модерация: жалоба на пользователя/сообщение и список заблокированных.
const reportTarget = ref<{
  userId: number
  userName: string
  chatId?: number
  messageId?: number
  messagePreview?: string
} | null>(null)
const showBlockedUsers = ref(false)
const showReports = ref(false)
const voiceRecOpen = ref(false)
const videoRecOpen = ref(false)

// ---------- Quasar: адаптивный layout (drawer на мобильном) ----------
const $q = useQuasar()
// История роутера — единственный «писатель» адреса и истории (см. syncChatUrl).
const router = useRouter()
/** «Десктоп» = ширина окна ≥ 1024px (md и выше). Ниже — мобильный режим. */
const isDesktop = computed(() => $q.screen.gt.sm)

/**
 * id чата из адреса — читаем ДО первого рендера, чтобы после перезагрузки чат
 * открывался сразу, а список чатов не мелькал. Значение живёт в `?chat=<id>`
 * (см. `syncChatUrl`). Исключение — запуск из push-кнопки «пометить прочитанным»
 * (`markread=1`): там чат открывать не нужно.
 */
/**
 * Открытый чат берём ТОЛЬКО из адреса (`?chat=`).
 *
 * Адрес возвращает в тот же чат при перезагрузке (pull-to-refresh, кнопка
 * «Обновить»). Запуск приложения заново (с домашнего экрана, из недавних — там
 * адрес всегда `start_url` «/») всегда открывает главную: человек возвращается в
 * мессенджер и сам решает, куда идти.
 */
const initialSearch = typeof window === 'undefined' ? '' : window.location.search
const initialChatFromUrl = chatIdFromUrl(initialSearch)
/**
 * Запуск по кнопке «Ответить» в уведомлении: после открытия чата нужно
 * поставить курсор в поле ввода. Читаем флаг СРАЗУ: адрес тут же
 * переписывается (`?reply=1` — одноразовый параметр).
 */
const replyLaunchRequested = isReplyLaunch(initialSearch)
const initialChatId =
  new URLSearchParams(initialSearch).get('markread') === '1' ? null : initialChatFromUrl

/** На мобильном список и нить — один экран: если в адресе чат, показываем нить. */
const initialDrawerOpen = initialChatId === null || isDesktop.value

/** Открыт ли drawer со списком чатов (значим в мобильном режиме). */
const drawerOpen = ref(initialDrawerOpen)
/** Ширина панели чатов: фикс. 380px на десктопе, почти во весь экран на мобильном. */
const drawerWidth = computed(() => (isDesktop.value ? 380 : Math.min($q.screen.width, 460)))

/**
 * Держим открытый чат в адресной строке (`?chat=<id>`), чтобы перезагрузка
 * страницы — в том числе pull-to-refresh или переоткрытие PWA — возвращала в тот
 * же чат, а не в список.
 *
 * Пишем через историю РОУТЕРА (а не window.history.replaceState): прямая запись
 * затирает служебные поля vue-router (position/back/forward) в записи истории,
 * роутер считает состояние «подменённым» и переписывает адрес. Из-за этого
 * «назад» срабатывал не всегда, а обновление открывало не ту страницу.
 */
const syncChatUrl = (chatId: number | null) => {
  try {
    const next = chatUrlWith(window.location.href, chatId)
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (next === current) return
    router.options.history.replace(next, {})
  } catch {
    /* история недоступна (например, внутри iframe) — просто не трогаем адрес */
  }
}

/** На мобильном: «назад» из открытого чата — снова показать список (drawer). */
const goBackToList = () => {
  if (!isDesktop.value) {
    // Если открытие чата записано в историю — идём «назад» по ней (popstate
    // откроет список), иначе просто показываем список.
    if (window.history.state && window.history.state.pismoNav) {
      window.history.back()
      return
    }
    drawerOpen.value = true
    syncChatUrl(null)
  } else {
    view.value = 'contacts'
  }
}

// ---------- Мобильная «назад»: история приложения вместо выхода ----------
// Каждый «прямой» переход (открытие чата/контактов/модалки) кладёт маркер в
// историю; на popstate откатываем экран на шаг. На «корне» (список чатов)
// системная «назад» выходит из приложения.
const pushMobileNav = (section?: Section) => {
  if (isDesktop.value) return
  try {
    // В записи истории храним раздел, который будет показан на этом шаге:
    // по «назад» возвращаемся именно в него, а не всегда в «Чаты».
    //
    // Пишем через историю РОУТЕРА: window.history.pushState затирает его
    // служебные поля (position/back/forward), и роутер начинает переписывать
    // адрес — история и экран расходятся.
    const url = `${window.location.pathname}${window.location.search}${window.location.hash}`
    router.options.history.push(url, {
      pismoNav: true,
      pismoView: section ?? view.value
    })
  } catch {
    /* история недоступна — игнорируем */
  }
}

/** Идёт обработка системного «назад» — программные шаги назад не нужны. */
let handlingSystemBack = false
/** Маркер гасим сами (программным шагом назад) — обработчик popstate молчит. */
let programmaticBack = false
/** Drawer открылся сам (по системному «назад») — маркер уже израсходован. */
let drawerOpenedByBack = false
/** Drawer открыли мы сами (переход в раздел) — чужие маркеры не гасим. */
let drawerOpenedBySection = false

/** Показать список разделов на мобильном (открыть drawer), не гася историю. */
const revealDrawer = () => {
  if (isDesktop.value || drawerOpen.value) return
  drawerOpenedBySection = true
  drawerOpen.value = true
}

/**
 * Гасит маркер истории, поставленный `pushMobileNav()`.
 *
 * Нужен, когда экран закрыли «вручную» (крестик, клик по фону, жест, действие
 * над выбранным): без этого маркер остаётся висеть, и следующее системное
 * «назад» тратится на пустой шаг — человек видит, что «назад не работает».
 * Возвращает true, если маркер был и его убрали.
 */
const stepBackInApp = (): boolean => {
  if (isDesktop.value || handlingSystemBack) return false
  const state = window.history.state as { pismoNav?: boolean } | null
  if (!state?.pismoNav) return false
  programmaticBack = true
  try {
    router.options.history.go(-1)
  } catch {
    programmaticBack = false
    return false
  }
  return true
}

/**
 * Обработка шага назад (системный жест/кнопка или `stepBackInApp`).
 * Закрываем ровно один слой интерфейса — от верхнего к нижнему.
 */
const handleAppBack = (state: { pismoView?: Section } | null) => {
  const step = decideBackStep({
    storyOpen: openStoryId.value !== null,
    lightboxOpen: lightboxIndex.value !== null,
    profileOpen: showProfileModal.value,
    profileInSection: profileRef.value?.isInSection() ?? false,
    chatInfoOpen: showChatInfoModal.value,
    groupInfoOpen: showGroupInfoModal.value,
    createGroupOpen: showCreateGroupModal.value,
    inviteOpen: inviteDialogOpen.value,
    messageSelection: msgSelectionMode.value,
    chatSelection: sidebarRef.value?.isSelecting() ?? false,
    currentView: view.value,
    previousView: state?.pismoView,
    chatOpen: selectedChatId.value !== null,
    drawerOpen: drawerOpen.value,
    isDesktop: isDesktop.value
  })

  switch (step.kind) {
    case 'story':
      openStoryId.value = null
      return
    case 'lightbox':
      lightboxIndex.value = null
      return
    case 'profile-section':
      profileRef.value?.backToSections()
      return
    case 'overlays':
      showProfileModal.value = false
      showChatInfoModal.value = false
      showGroupInfoModal.value = false
      showCreateGroupModal.value = false
      return
    case 'invite':
      closeInviteDialog()
      return
    case 'message-selection':
      exitMessageSelection()
      return
    case 'chat-selection':
      sidebarRef.value?.exitSelection()
      return
    case 'section':
      view.value = step.section
      // На мобильном раздел живёт в списке (drawer), а не отдельным экраном:
      // если открыта переписка — закрываем её и показываем список раздела
      // (см. `showList` в utils/mobileNav.ts).
      if (step.showList) {
        if (selectedChatId.value !== null) closeOpenChat()
        revealDrawer()
      }
      return
    case 'list':
      // Открытая нить (drawer скрыт) → список.
      drawerOpenedByBack = true
      drawerOpen.value = true
      // На мобильном список и нить — один экран: показали список, значит и в
      // адресе чата быть не должно.
      syncChatUrl(null)
      return
    case 'exit':
      // Корень — выходим (позволяем браузеру завершить).
      return
  }
}

const onAppPopState = (event: PopStateEvent) => {
  // Маркер погасили сами (экран уже закрыт вручную) — обрабатывать нечего.
  if (programmaticBack) {
    programmaticBack = false
    return
  }
  if (isDesktop.value) return
  handlingSystemBack = true
  try {
    handleAppBack(event.state as { pismoView?: Section } | null)
  } finally {
    handlingSystemBack = false
  }
}

// ---------- Данные ----------

// Раздел помним между перезагрузками (кнопка «Обновить», pull-to-refresh):
// иначе человек, читавший истории, после обновления оказывался на «Чатах».
// Запуск приложения заново всегда открывает главную (см. utils/chatUrl).
const view = ref<Section>(readStoredSection())
const chats = ref<Chat[]>([])
const messages = ref<Message[]>([])

// ---------- Временные пузыри «Отправка…» для загружаемых вложений ----------
interface PendingUpload {
  localId: number
  label: string
  previewUrl?: string | null
  /** Процент загрузки на сервер (undefined — ещё не началась). */
  progress?: number
}
const pendingUploads = ref<PendingUpload[]>([])
let pendingSeq = 0

/**
 * Отметить прогресс загрузки вложения. Массив пересобираем: строка в ленте
 * должна обновиться, а лишние перерисовки гасим сравнением процента.
 */
const setPendingProgress = (localId: number, percent: number) => {
  if (!pendingUploads.value.some((p) => p.localId === localId && p.progress !== percent)) return
  pendingUploads.value = pendingUploads.value.map((p) =>
    p.localId === localId ? { ...p, progress: percent } : p
  )
}

/** Создать временный пузырь «Отправка…» и вернуть его localId. */
const addPendingUpload = (label: string, previewUrl: string | null = null): number => {
  const localId = --pendingSeq
  pendingUploads.value = [...pendingUploads.value, { localId, label, previewUrl }]
  return localId
}

/** Убрать временный пузырь (успех, ошибка или смена чата). */
const removePendingUpload = (localId: number) => {
  pendingUploads.value = pendingUploads.value.filter((p) => p.localId !== localId)
}

const clearPendingUploads = () => {
  for (const p of pendingUploads.value) {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
  }
  pendingUploads.value = []
}
const pinnedMessages = ref<Message[]>([])
// Раздел «Контакты» — моя записная книжка (кого я добавил и как назвал),
// а не справочник всех пользователей: справочник ищется через поиск.
const contactsStore = useContactsStore()
const contacts = computed<ChatUser[]>(() => contactsStore.users)
const loadingChats = ref(false)
const messagesLoading = ref(false)
const contactsLoading = computed(() => contactsStore.loading)
const selectedChatId = ref<number | null>(initialChatId)

const newMessage = ref('')
const sending = ref(false)
const sendingFile = ref(false)
const sendError = ref('')

const replyTarget = ref<Message | null>(null)
const inlineSearchOpen = ref(false)
const inlineQuery = ref('')
const emojiPickerFor = ref<number | null>(null)
// Единое меню доп.контента поля ввода: 'emoji' | 'gif' | закрыто.
const extrasTab = ref<'emoji' | 'gif'>('emoji')
const extrasPanel = ref<'none' | 'emoji' | 'gif'>('none')
const pinnedOpen = ref(true)
const highlightedMessageId = ref<number | null>(null)
let highlightTimer: number | undefined

/** Ссылка на ленту сообщений (MessageThread) для управления прокруткой. */
const threadRef = ref<InstanceType<typeof MessageThread> | null>(null)
/** Панель ввода: нужна, чтобы поставить курсор после «Ответить» из уведомления. */
const composerRef = ref<InstanceType<typeof MessageComposer> | null>(null)
/** Список чатов: нужен доступ к режиму выделения (жест «назад» из него выходит). */
const sidebarRef = ref<InstanceType<typeof ChatSidebar> | null>(null)

/**
 * Сколько сообщений было непрочитано в момент открытия чата.
 * Нужно ленте, чтобы нарисовать разделитель «Непрочитанные сообщения» и
 * открыть чат на нём, а не прыгать в самый низ. Обнуляется при выборе чата.
 */
const unreadAtOpen = ref(0)

// ---------- Фон окна сообщений (обои берутся из store оформления) ----------
const chatBgStyle = computed(() => ({ background: themeStore.wallpaperCss }))

// ---------- Вычисляемые значения ----------
const currentUserId = computed<number | null>(() => authStore.current_user?.id ?? null)

/** Своё имя/аватар — для кнопки «Профиль» (аватар) слева в списке чатов. */
const selfName = computed<string>(() =>
  authStore.current_user ? displayName(authStore.current_user) : ''
)
const selfAvatarUrl = computed<string | undefined>(() => avatarUrlOf(authStore.current_user))

const selectedChat = computed<Chat | null>(() => {
  if (selectedChatId.value === null) return null
  return chats.value.find((chat) => chat.id === selectedChatId.value) ?? null
})

const messageRows = computed<ThreadRow[]>(() => buildMessageRows(messages.value, inlineQuery.value))

// ---------- Закреплённые чаты (пин вверху списка диалогов) ----------
const PINNED_CHATS_KEY = 'pismo_pinned_chats'

const readPinnedChats = (): number[] => {
  const uid = currentUserId.value
  if (uid === null) return []
  try {
    const raw = window.localStorage.getItem(PINNED_CHATS_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, number[]>) : {}
    const list = all[String(uid)]
    return Array.isArray(list) ? list.filter((id) => typeof id === 'number') : []
  } catch {
    return []
  }
}

const writePinnedChats = () => {
  const uid = currentUserId.value
  if (uid === null) return
  try {
    const raw = window.localStorage.getItem(PINNED_CHATS_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, number[]>) : {}
    all[String(uid)] = pinnedChatIds.value
    window.localStorage.setItem(PINNED_CHATS_KEY, JSON.stringify(all))
  } catch {
    // localStorage недоступен — пин просто не сохранится.
  }
}

const pinnedChatIds = ref<number[]>([])

watch(
  currentUserId,
  () => {
    pinnedChatIds.value = readPinnedChats()
  },
  { immediate: true }
)

const isChatPinned = (chatId: number): boolean => pinnedChatIds.value.includes(chatId)

const toggleChatPinned = (chatId: number) => {
  const next = new Set(pinnedChatIds.value)
  if (next.has(chatId)) {
    next.delete(chatId)
  } else {
    next.add(chatId)
  }
  pinnedChatIds.value = Array.from(next)
  writePinnedChats()
}

/** Закрепить/открепить сразу несколько чатов (режим выделения). */
const bulkSetPinned = (chatIds: number[], pinned: boolean) => {
  const next = new Set(pinnedChatIds.value)
  chatIds.forEach((id) => {
    if (pinned) next.add(id)
    else next.delete(id)
  })
  pinnedChatIds.value = Array.from(next)
  writePinnedChats()
}

/** Закреплён ли открытый чат (состояние кнопки в шапке). */
const selectedChatPinned = computed<boolean>(
  () => selectedChat.value !== null && isChatPinned(selectedChat.value.id)
)

/** Закрепить/открепить открытый чат. */
const toggleCurrentChatPin = () => {
  const chat = selectedChat.value
  if (chat !== null) toggleChatPinned(chat.id)
}

// ---------- Замьюченные чаты (без push-уведомлений; mute хранится на сервере) ----------
// Сервер не шлёт Web Push в замьюченные чаты (таблица chat_mutes). Здесь mute
// управляет только индикаторами (значок в списке). Состояние приходит в каждом
// чате списка (поле muted) и обновляется при синхронизации.
const mutedChatIds = computed(() => chats.value.filter((chat) => chat.muted).map((chat) => chat.id))

const toggleChatMuted = async (chatId: number) => {
  const chat = chats.value.find((item) => item.id === chatId)
  if (!chat) return
  const next = !chat.muted
  // Оптимистично обновляем, при ошибке — откатываем.
  chat.muted = next
  try {
    await setChatMuted(chatId, next)
  } catch (error) {
    chat.muted = !next
    console.error('Не удалось изменить mute чата:', getErrorMessage(error))
  }
}

/** Массово включает/выключает уведомления выбранных чатов. */
const bulkSetMuted = async (chatIds: number[], muted: boolean) => {
  const targets = chatIds
    .map((id) => chats.value.find((item) => item.id === id))
    .filter((chat): chat is Chat => chat !== undefined)
  for (const chat of targets) {
    const previous = chat.muted
    chat.muted = muted
    try {
      await setChatMuted(chat.id, muted)
    } catch (error) {
      chat.muted = previous
      console.error('Не удалось изменить mute чата:', getErrorMessage(error))
    }
  }
}

// ---------- Тип чата: обычный / зашифрованный (E2EE) ----------
// По умолчанию чаты «обычные» — текст хранится на сервере как есть и виден в
// превью списка и в уведомлениях. Включение E2EE переводит чат в «зашифрованный»:
// новые текстовые сообщения шифруются, сервер их не читает.
const applyChatE2ee = async (chatId: number, enabled: boolean) => {
  const chat = chats.value.find((item) => item.id === chatId)
  if (!chat || chat.e2ee_enabled === enabled) return
  const previous = chat.e2ee_enabled
  // Оптимистично обновляем, при ошибке — откатываем.
  chat.e2ee_enabled = enabled
  try {
    await setChatE2ee(chatId, enabled)
    // В группе мало включить флаг: ключ нужно раздать участникам.
    if (enabled && isGroupChat(chat)) await distributeGroupKeys(chatId)
    // Обновляем готовность ключа — от неё зависит замок в шапке.
    void prepareChatE2ee(chatId)
  } catch (error) {
    chat.e2ee_enabled = previous
    console.error('Не удалось изменить тип чата:', getErrorMessage(error))
  }
}

/**
 * Раздаёт ключ группы участникам (или пересобирает его).
 *
 * `rotate` — выпустить НОВЫЙ ключ: обязателен после исключения участника,
 * иначе исключённый продолжит читать новые сообщения.
 */
const distributeGroupKeys = async (chatId: number, rotate = false): Promise<void> => {
  const uid = currentUserId.value
  if (uid === null || !e2eeMyKeyReady.value) return
  try {
    const detail = await fetchChatDetail(chatId)
    const ids = detail.members.map((member) => member.id)
    const { missing } = await distributeGroupKey(uid, chatId, ids, { rotate })
    if (missing.length > 0) {
      console.warn(
        'Ключ группы не удалось отдать участникам (нет ключа устройства):',
        missing.join(', ')
      )
    }
  } catch (error) {
    console.error('Не удалось раздать ключ группы:', getErrorMessage(error))
  }
}

/** Состав группы изменился — ключ надо пересобрать (после исключения — новый). */
const onGroupMembersChanged = (rotate: boolean) => {
  const chat = selectedChat.value
  if (chat !== null) void distributeGroupKeys(chat.id, rotate)
}

/** Обработчик переключателя типа чата в «Информации о чате». */
const onChatInfoToggleE2ee = (enabled: boolean) => {
  const chat = selectedChat.value
  if (chat !== null) void applyChatE2ee(chat.id, enabled)
}

/** «Сохранить в Сохранённые сообщения» — пересылка сообщения в self-чат. */
const saveMessageToSelf = async (message: Message) => {
  const selfChat = chats.value.find((chat) => chat.is_self)
  const current = selectedChat.value
  // В самом «Сохранённых» или для служебных сообщений (звонки) не дублируем.
  if (!selfChat || message.kind === 'call' || (current !== null && current.is_self)) return
  try {
    await forwardMessage(message.id, selfChat.id)
  } catch (error) {
    console.error('Не удалось сохранить сообщение:', getErrorMessage(error))
  }
}

// ---------- Просмотр изображений (lightbox) ----------
/**
 * Ссылка на кадр. Для зашифрованного вложения читаем только состояние кэша
 * (`enabled: () => false` не запускает загрузку) — расшифровку запрашивает
 * `watch` ниже, когда кадр реально показывают. Иначе при каждом рендере чата
 * скачивались и расшифровывались ВСЕ изображения истории.
 * Пока кадр не готов, ссылка пустая: лайтбокс показывает загрузку. Подставлять
 * сюда ссылку на шифротекст нельзя — получится «битая» картинка.
 */
const lightboxUrlOf = (message: Message): string => {
  if (!message.e2ee_file) {
    const attachment = effectiveFile(message)
    return attachment === null ? '' : mediaUrl(attachment.url)
  }
  const local = decryptedMediaFor(message, { enabled: () => false })
  return local?.status === 'ready' ? local.url : ''
}

const lightboxItems = computed(() => buildLightboxItems(messages.value, lightboxUrlOf))
const lightboxIndex = ref<number | null>(null)

/** Расшифровываем текущий кадр и соседей — листание без ожидания. */
watch([lightboxIndex, lightboxItems], () => {
  const index = lightboxIndex.value
  if (index === null) return
  const items = lightboxItems.value
  for (const i of neighborIndexes(index, items.length)) {
    const item = items[i]
    if (item?.message.e2ee_file) decryptedMediaFor(item.message)
  }
})

const openImageFromMessage = (message: Message) => {
  if (lightboxItems.value.length === 0) return
  const idx = lightboxItems.value.findIndex((item) => item.id === message.id)
  // Лайтбокс — полноэкранный слой: системная «назад» должна закрывать его
  // (см. `handleAppBack`), значит нужен маркер в истории.
  pushMobileNav()
  lightboxIndex.value = idx >= 0 ? idx : 0
}

const closeLightbox = () => {
  lightboxIndex.value = null
}

const lightboxStep = (delta: number) => {
  if (lightboxIndex.value === null || lightboxItems.value.length === 0) return
  const length = lightboxItems.value.length
  lightboxIndex.value = (lightboxIndex.value + delta + length) % length
}

// ---------- Информация о чате / группе ----------
const openChatInfo = () => {
  pushMobileNav()
  const chat = selectedChat.value
  if (chat && isGroupChat(chat)) {
    showGroupInfoModal.value = true
  } else {
    showChatInfoModal.value = true
  }
}

/** Открыть изображение из «Информации о чате» в лайтбоксе. */
const openChatInfoImage = async (messageId: number) => {
  // Галерея показывает вложения всей истории, а в ленте загружены только
  // последние страницы: нужную подгружаем перед открытием лайтбокса.
  const message = await ensureMessageLoaded(messageId)
  if (message) openImageFromMessage(message)
}

/**
 * Гарантирует, что сообщение есть в ленте (для перехода к нему/просмотра).
 *
 * Если его нет в загруженных страницах, догружает страницу, в которую оно
 * попадает, вставляет в ленту и возвращает позицию прокрутки на место — иначе
 * лента «прыгнула» бы вверх у пользователя.
 */
const ensureMessageLoaded = async (messageId: number): Promise<Message | undefined> => {
  const known = messages.value.find((m) => m.id === messageId)
  if (known) return known
  const chatId = selectedChatId.value
  if (chatId === null) return undefined
  const saved = threadRef.value?.capture()
  try {
    const raw = await fetchMessages(chatId, {
      limit: MESSAGES_PAGE_SIZE,
      beforeId: messageId + 1
    })
    const page = await applyDecryptMessages(chatId, raw)
    if (!page.some((m) => m.id === messageId)) return undefined
    const existingIds = new Set(messages.value.map((m) => m.id))
    const toAdd = page.filter((m) => !existingIds.has(m.id))
    if (toAdd.length > 0) {
      messages.value = [...toAdd, ...messages.value].sort((a, b) => a.id - b.id)
      await nextTick()
      if (saved) threadRef.value?.restoreScroll(saved.top, saved.height)
    }
    return messages.value.find((m) => m.id === messageId)
  } catch (error) {
    console.error('Не удалось загрузить сообщение с вложением:', getErrorMessage(error))
    return undefined
  }
}

// ---------- Создание группы ----------
const openCreateGroup = () => {
  pushMobileNav()
  showCreateGroupModal.value = true
}

/** Строки закреплённых сообщений для PinnedBar (имя + сниппет уже посчитаны). */
const pinnedRows = computed(() =>
  pinnedMessages.value.map((message) => ({
    id: message.id,
    sender: senderNameOfMessage(message),
    snippet: pinnedSnippet(message)
  }))
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
      /** Миниатюра 128px: экран звонка показывает аватар кружком. */
      avatar_thumb_url?: string | null
    }
  | undefined => {
  for (const chat of chats.value) {
    const other = otherUserOfChat(chat)
    if (other && other.id === id) return other
  }
  return contacts.value.find((contact) => contact.id === id)
}

const isPrivateChat = (chat: Chat | null): boolean =>
  !!chat && !chat.is_group && !chat.is_self && chat.users.length === 2

// ---------- Сквозное шифрование (E2EE): ключи, шифрование/расшифровка ----------
/** Мой ключ готов и опубликован на сервере (можно шифровать исходящие). */
const e2eeMyKeyReady = ref(false)
/** Для открытого чата: есть ли у собеседника опубликованный ключ. */
const e2eePeerReadyByChat = ref<Record<number, boolean>>({})

/**
 * Ключ чата для шифрования/расшифровки: у личного чата — общий секрет двух
 * сторон, у группы — её собственный ключ. null = чат не зашифрован/ключей нет.
 */
const chatKeyOf = async (chat: Chat | null): Promise<CryptoKey | null> => {
  const uid = currentUserId.value
  if (uid === null || !chat || !chat.e2ee_enabled || !e2eeMyKeyReady.value) return null
  return chatAesKeyFor(uid, chat)
}

/**
 * Локально подставляет расшифрованный конверт отправленного файла: сервер
 * вернул шифротекст и нейтральное имя, а настоящее имя/тип/подпись есть только
 * у нас — иначе пузырь мигал бы «замком» до повторной расшифровки.
 */
const applyLocalFileEnvelope = (message: Message, meta: EncryptedFileMeta): void => {
  message.e2ee_file = meta
  message.text = meta.c ?? ''
  message.encrypted = false
  if (message.file) {
    message.file = { ...message.file, name: meta.n, mime: meta.m, size: meta.s }
  }
}

/** Проверяет готовность чата к E2EE (ключ собеседника/группы) — для замка в шапке. */
const prepareChatE2ee = async (chatId: number): Promise<void> => {
  const uid = currentUserId.value
  const chat = chats.value.find((c) => c.id === chatId) ?? selectedChat.value
  if (uid === null || !chat || !isE2eeAvailable()) return
  const ready = await e2eeReadyForChat(uid, chat)
  e2eePeerReadyByChat.value = {
    ...e2eePeerReadyByChat.value,
    [chatId]: ready
  }
}

/** E2EE активен для открытого чата (бейдж/подпись в шапке). */
const selectedChatE2ee = computed<boolean>(() => {
  const chat = selectedChat.value
  // Замок показываем только если чат «зашифрованный» (тип включён) и обе стороны
  // реально готовы шифровать (есть ключи устройства).
  if (!chat || !chat.e2ee_enabled || !e2eeMyKeyReady.value) return false
  return !!e2eePeerReadyByChat.value[chat.id]
})

/**
 * Расшифровывает E2EE-сообщения списка «в памяти» (плоский текст не храним).
 * Если расшифровать нечем/нечем — подставляем заглушку, а не шифротекст.
 */
const applyDecryptMessages = async (chatId: number, list: Message[]): Promise<Message[]> => {
  const need = list.filter((m) => m.encrypted && isEncryptedPayload(m.text))
  if (need.length === 0) return list
  const chat = chats.value.find((c) => c.id === chatId) ?? selectedChat.value
  const key = await chatKeyOf(chat)
  const fallback = (m: Message): Message =>
    m.encrypted && isEncryptedPayload(m.text) ? { ...m, text: ENCRYPTED_FALLBACK } : m
  if (!key) return list.map(fallback)
  const out: Message[] = []
  for (const m of list) {
    if (!m.encrypted || !isEncryptedPayload(m.text)) {
      out.push(m)
      continue
    }
    const plain = await decryptText(key, m.text)
    if (plain === null) {
      out.push({ ...m, text: ENCRYPTED_FALLBACK })
      continue
    }
    // Зашифрованное вложение: в тексте лежит конверт с ключом файла, его
    // настоящим именем/типом и подписью. Показываем подпись, а сам файл
    // расшифровывает useDecryptedMedia (по нему строится blob-ссылка).
    const meta = m.file ? parseFileMeta(plain) : null
    if (meta) {
      out.push({ ...m, text: meta.c ?? '', encrypted: false, e2ee_file: meta })
    } else {
      out.push({ ...m, text: plain, encrypted: false })
    }
  }
  // Заранее запускаем расшифровку вложений: к моменту отрисовки/лайтбокса
  // картинки уже готовы (и грузятся один раз на сообщение).
  preloadDecryptedMedia(out)
  return out
}

const isOwnMessage = (message: Message): boolean =>
  currentUserId.value !== null && message.user_id === currentUserId.value

const startVoiceCall = () => {
  const chat = selectedChat.value
  if (!isPrivateChat(chat)) return
  const peer = otherUserOfChat(chat as Chat)
  if (!peer) return
  void callStore.startCall(
    {
      id: peer.id,
      name: displayName(peer),
      // В экране звонка аватар — кружок: берём миниатюру, если она есть.
      avatarUrl: peer.avatar_thumb_url ?? peer.avatar_url ?? null
    },
    'audio'
  )
}

const startVideoCall = () => {
  const chat = selectedChat.value
  if (!isPrivateChat(chat)) return
  const peer = otherUserOfChat(chat as Chat)
  if (!peer) return
  void callStore.startCall(
    {
      id: peer.id,
      name: displayName(peer),
      // В экране звонка аватар — кружок: берём миниатюру, если она есть.
      avatarUrl: peer.avatar_thumb_url ?? peer.avatar_url ?? null
    },
    'video'
  )
}

/** Кнопка звонка в шапке чата: клик (без удержания) = звонок выбранного типа. */
const startCall = (kind: 'audio' | 'video') => {
  if (kind === 'video') startVideoCall()
  else startVoiceCall()
}

/** Задаваемый собеседником текст-статус (для шапки личного чата). */
const peerStatus = (chat: Chat): string => {
  const other = otherUserOfChat(chat)
  if (!other || !isPrivateChat(chat)) return ''
  return (other.status ?? '').trim()
}

// ---------- Присутствие + индикатор «печатает…» (состояние в composable) ----------
const {
  peerPresence,
  peerTypingUntil,
  isWithinOnlineWindow,
  applyPresence,
  isPeerTyping,
  markPeerTyping,
  clearPeerTyping,
  clearAll
} = usePeerActivity({
  isMe: (userId) => userId === currentUserId.value
})

/** id пользователей, которые сейчас «в сети» (для индикатора на аватарах). */
const onlineUserIds = computed<number[]>(() =>
  Object.entries(peerPresence)
    .filter(([, state]) => state.online)
    .map(([userId]) => Number(userId))
)

/** id чатов, где собеседник сейчас «печатает…» (для списка диалогов). */
const typingChatIds = computed<number[]>(() =>
  Object.keys(peerTypingUntil)
    .filter((chatId) => isPeerTyping(Number(chatId)))
    .map((chatId) => Number(chatId))
)

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

/** «В сети» ли собеседник открытого личного чата (точка на аватаре в шапке). */
const selectedChatPeerOnline = computed<boolean>(() => {
  const chat = selectedChat.value
  if (!chat || chat.users.length !== 2) return false
  const peer = otherUserOfChat(chat)
  return peer !== undefined && onlineUserIds.value.includes(peer.id)
})

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
  if (isGroupChat(chat)) return groupSubtitle(chat)
  return presenceText(chat)
}

/** Подпись шапки группы: число участников и сколько из них сейчас в сети. */
const groupSubtitle = (chat: Chat): string => {
  const count = chat.users.length
  const online = chat.users.filter((u) => onlineUserIds.value.includes(u.id)).length
  const last = count % 10
  const lastTwo = count % 100
  let noun: string
  if (lastTwo >= 11 && lastTwo <= 14) noun = 'участников'
  else if (last === 1) noun = 'участник'
  else if (last >= 2 && last <= 4) noun = 'участника'
  else noun = 'участников'
  return online > 0 ? `${count} ${noun} · ${online} в сети` : `${count} ${noun}`
}

// ---------- Цитаты (ответы) ----------
const replyMessage = (message: Message): Message | undefined =>
  message.reply_to_id != null
    ? messages.value.find((item) => item.id === message.reply_to_id)
    : undefined

/** Имя автора сообщения (для групп — участник по user_id). */
const authorNameOfMessage = (message: Message): string => {
  const chat = chats.value.find((item) => item.id === message.chat_id)
  if (!chat) return 'Собеседник'
  const author = chat.users.find((user) => user.id === message.user_id)
  return author ? displayName(author) : 'Собеседник'
}

/** Имя в шапке цитаты при ответе в композере (семантика исходного Messenger). */
const quoteName = (message: Message): string => {
  const target = replyMessage(message)
  if (!target) return 'Сообщение'
  return isOwnMessage(target) ? 'Вы' : authorNameOfMessage(target)
}

const replyBarName = computed<string>(() => (replyTarget.value ? quoteName(replyTarget.value) : ''))

/** Данные ответа-цитаты для строки сообщения (null — цитата не загружена). */
const quoteFor = (message: Message): { name: string; mine: boolean; text: string } | null => {
  if (message.reply_to_id == null) return null
  const target = replyMessage(message)
  if (!target) return null
  const mine = isOwnMessage(target)
  return {
    name: mine ? 'Вы' : authorNameOfMessage(target),
    mine,
    text: messageSnippet(target)
  }
}

/** Клик по цитате-ответу: закрыть меню и перейти к исходному сообщению. */
const quoteClick = (message: Message) => {
  emojiPickerFor.value = null
  const targetId = message.reply_to_id
  if (targetId == null) return
  // Исходное сообщение может быть не загружено — тогда ничего не делаем.
  if (!messages.value.some((item) => item.id === targetId)) return
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
  highlightedMessageId.value = targetId
  void nextTick(() => {
    threadRef.value?.reveal(targetId)
    highlightTimer = window.setTimeout(() => {
      highlightedMessageId.value = null
    }, 2400)
  })
}

const senderNameOfMessage = (message: Message): string => authorNameOfMessage(message)

const pinnedSnippet = (message: Message): string =>
  `${message.user_id === currentUserId.value ? 'Вы: ' : senderNameOfMessage(message) + ': '}${messageSnippet(message)}`

// ---------- Реакции ----------
const hasMyReaction = (message: Message, emoji: string): boolean =>
  message.reactions.some((reaction) => reaction.reacted_by_me && reaction.emoji === emoji)

const toggleEmojiPicker = (messageId: number) => {
  emojiPickerFor.value = emojiPickerFor.value === messageId ? null : messageId
}

/** Обработчик «выбор реакций» от строки ленты (лента отдаёт сообщение). */
const onToggleEmojiPicker = (message: Message) => {
  toggleEmojiPicker(message.id)
}

const closePopups = () => {
  emojiPickerFor.value = null
  extrasPanel.value = 'none'
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
    messages.value = await applyDecryptMessages(
      chatId,
      await fetchMessages(chatId, { limit: MESSAGES_PAGE_SIZE })
    )
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
  const freshRaw = await fetchMessages(chatId, { limit: MESSAGES_PAGE_SIZE })
  const fresh = await applyDecryptMessages(chatId, freshRaw)
  const freshIds = new Set(fresh.map((m) => m.id))
  const keptOlder = messages.value.filter((m) => !freshIds.has(m.id))
  messages.value = [...keptOlder, ...fresh].sort((a, b) => a.id - b.id)
  const hasNew = fresh.some((m) => !previousIds.has(m.id))
  if (hasNew && (!threadRef.value || threadRef.value.isNearBottom())) {
    await nextTick()
    scrollToBottom()
  }
  return hasNew
}

/** Подгружает более старые сообщения при прокрутке вверх (вызывается лентой). */
const loadOlderMessages = async () => {
  const chatId = selectedChatId.value
  if (chatId === null || loadingOlder.value || noMoreOlder.value || messages.value.length === 0) {
    return
  }
  const saved = threadRef.value?.capture()
  const prevScrollHeight = saved?.height ?? 0
  const prevScrollTop = saved?.top ?? 0
  const oldestId = messages.value.reduce<number | null>(
    (min, m) => (min === null || m.id < min ? m.id : min),
    null
  )
  loadingOlder.value = true
  try {
    const olderRaw = await fetchMessages(chatId, {
      limit: MESSAGES_PAGE_SIZE,
      beforeId: oldestId ?? undefined
    })
    const older = await applyDecryptMessages(chatId, olderRaw)
    const existingIds = new Set(messages.value.map((m) => m.id))
    const toAdd = older.filter((m) => !existingIds.has(m.id))
    if (older.length === 0 || toAdd.length === 0) {
      noMoreOlder.value = true
      return
    }
    messages.value = [...toAdd, ...messages.value].sort((a, b) => a.id - b.id)
    await nextTick()
    threadRef.value?.restoreScroll(prevScrollTop, prevScrollHeight)
  } catch (error) {
    console.error('Не удалось загрузить более старые сообщения:', getErrorMessage(error))
  } finally {
    loadingOlder.value = false
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
  try {
    await contactsStore.load()
  } catch (error) {
    console.error('Не удалось загрузить контакты:', getErrorMessage(error))
  }
}

const refreshThread = async () => {
  const chatId = selectedChatId.value
  if (chatId === null) return
  await Promise.all([mergeThreadLatest(chatId), loadPinned(chatId), loadChats()])
}

const scrollToBottom = () => {
  threadRef.value?.scrollToBottom()
}

// ---------- Выбор / открытие чата ----------
/**
 * Открывает чат: сбрасывает состояние и грузит свежую порцию сообщений.
 *
 * `pushNav: false` — восстановление чата при запуске/перезагрузке: адрес уже
 * указывает на этот чат, а лишний шаг истории делал бы «назад» через раз.
 */
const openChatThread = async (chatId: number, options: { pushNav?: boolean } = {}) => {
  const pushNav = options.pushNav !== false
  // Запоминаем непрочитанные до обнуления: лента нарисует по ним разделитель.
  unreadAtOpen.value = chats.value.find((item) => item.id === chatId)?.unread_count ?? 0
  selectedChatId.value = chatId
  // Открытый чат виден в адресе: перезагрузка вернёт в него же.
  syncChatUrl(chatId)
  sendError.value = ''
  void prepareChatE2ee(chatId)
  messages.value = []
  pinnedMessages.value = []
  clearPendingUploads()
  inlineQuery.value = ''
  inlineSearchOpen.value = false
  clearReply()
  closeLightbox()
  showChatInfoModal.value = false
  showGroupInfoModal.value = false
  await Promise.all([loadThreadLatest(chatId), loadPinned(chatId)])
  // Blob-ссылки расшифрованных вложений других чатов больше не нужны.
  releaseDecryptedMediaExcept(messages.value.map((message) => message.id))
  // Мы читаем чат — непрочитанные обнуляем сразу (не дожидаясь синхронизации).
  const opened = chats.value.find((item) => item.id === chatId)
  if (opened) opened.unread_count = 0
  // Ждём отрисовки сообщений + два кадра, иначе scrollTop посчитается по ещё
  // не размеченной ленте и чат откроется не внизу (нужно докручивать).
  await nextTick()
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
  scrollToBottom()
  // Мобильный режим: выбор чата закрывает drawer — нить на весь экран.
  // Запоминаем шаг в истории, чтобы системная «назад» вернула к списку.
  if (!isDesktop.value) {
    if (pushNav) pushMobileNav()
    drawerOpen.value = false
  }
}

const selectChat = async (chatId: number) => {
  if (selectedChatId.value === chatId) {
    // Повторный выбор того же чата (он остался выбранным после «назад» в список):
    // на мобильном снова показываем нить. Обязательно возвращаем чат в адрес и в
    // память приложения — иначе после обновления страницы человек оказывался на
    // списке чатов, хотя был в переписке (?chat= в адресе не было).
    syncChatUrl(chatId)
    if (!isDesktop.value) {
      pushMobileNav()
      drawerOpen.value = false
    }
    return
  }
  await openChatThread(chatId)
}

/** Чат открыт из левой панели (find-or-create) — показываем его нить. */
const onChatOpened = async (chat: Chat) => {
  upsertChat(chat)
  view.value = 'chats'
  await openChatThread(chat.id)
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
      clearDraftFor(chatId)
      editingMessage.value = null
      replaceMessageInThread(updated)
      sendTypingStop(chatId)
      await loadPinned(chatId)
      scrollToBottom()
      return
    }

    // E2EE шифрует, только если чат «зашифрованный» (e2ee_enabled) и обе стороны
    // опубликовали ключи. Обычные чаты идут открытым текстом (текст виден в
    // превью списка и в push-уведомлениях — как в обычных чатах Telegram).
    let wireText = text
    let wireEncrypted = false
    const aes = await chatKeyOf(selectedChat.value)
    if (aes) {
      wireText = await encryptText(aes, text)
      wireEncrypted = true
      e2eePeerReadyByChat.value = {
        ...e2eePeerReadyByChat.value,
        [chatId]: true
      }
    }
    const message = await sendNewMessage(chatId, wireText, replyTarget.value?.id, wireEncrypted)
    if (wireEncrypted) {
      // Локально в ленте показываем открытый текст; шифротекст живёт на сервере.
      message.text = text
      message.encrypted = false
    }
    newMessage.value = ''
    clearDraftFor(chatId)
    sendTypingStop(chatId)
    clearReply()
    await refreshThread()
    messages.value = appendMessage(messages.value, message)
    await loadPinned(chatId)
    // Короткий отклик при отправке: понятно, что сообщение ушло, не сверяясь
    // с галочками (на телефоне ощущается как «нажалось»).
    haptic()
    scrollToBottom()
  } catch (error) {
    // Связь пропала — не теряем набранное: ставим в очередь и отправим сами,
    // как только сеть вернётся (сообщение видно в ленте как «Ждёт сети»).
    if (isNetworkError(error)) {
      queueOutgoingText(chatId, text, replyTarget.value?.id)
      newMessage.value = ''
      clearDraftFor(chatId)
      clearReply()
      void nextTick(scrollToBottom)
    } else {
      sendError.value = getErrorMessage(error, 'Не удалось отправить сообщение')
    }
  } finally {
    sending.value = false
  }
}

const appendMessage = (list: Message[], message: Message): Message[] => {
  if (list.some((item) => item.id === message.id)) return list
  return [...list, message]
}

const onFileSelected = async (file: File) => {
  const chatId = selectedChatId.value
  if (chatId === null) return

  sendError.value = ''
  // Сразу показываем временный пузырь (для фото — с превью), чтобы было видно,
  // что отправка идёт; затем заменяем его настоящим сообщением.
  const isImage = file.type.startsWith('image/')
  const previewUrl = isImage ? URL.createObjectURL(file) : null
  const localId = addPendingUpload(file.name || 'Вложение', previewUrl)
  void nextTick(scrollToBottom)

  sendingFile.value = true
  try {
    // Фото с камеры/галереи сжимаем на клиенте — грузится быстрее.
    const optimized = isImage ? await optimizeImageFile(file) : file
    const caption = newMessage.value.trim()
    // «Зашифрованный» чат: и содержимое, и настоящее имя файла уезжают
    // только в шифрованном виде (на сервере остаётся блоб enc_*.bin).
    const aes = await chatKeyOf(selectedChat.value)
    const payload = aes ? await encryptFileForChat(aes, optimized, caption) : null
    const message = await sendAttachmentMessage(
      chatId,
      payload ? payload.blob : optimized,
      payload ? payload.text : caption,
      replyTarget.value?.id,
      (percent) => {
        // Сжатие могло занять время — прогресс показываем только актуального пузыря.
        if (pendingUploads.value.some((p) => p.localId === localId)) {
          setPendingProgress(localId, percent)
        }
      },
      !!payload
    )
    if (payload) applyLocalFileEnvelope(message, payload.meta)
    removePendingUpload(localId)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    newMessage.value = ''
    clearDraftFor(chatId)
    clearReply()
    sendTypingStop(chatId)
    messages.value = appendMessage(messages.value, message)
    await Promise.all([loadPinned(chatId), loadChats()])
    scrollToBottom()
  } catch (error) {
    removePendingUpload(localId)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
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
  // Голосовое/видео тоже показываем временным пузырём с прогрессом:
  // длинная запись грузится не мгновенно.
  const label = kind === 'voice' ? 'Голосовое сообщение' : 'Видеосообщение'
  const localId = addPendingUpload(label)
  void nextTick(scrollToBottom)
  try {
    const file = new File([payload.blob], mediaFileName(kind, payload.mime), {
      type: payload.mime
    })
    // Голосовые и кружки шифруются так же, как обычные вложения.
    const aes = await chatKeyOf(selectedChat.value)
    const encrypted = aes ? await encryptFileForChat(aes, file) : null
    const message = await sendAttachmentMessage(
      chatId,
      encrypted ? encrypted.blob : file,
      encrypted ? encrypted.text : '',
      replyTarget.value?.id,
      (percent) => {
        if (pendingUploads.value.some((p) => p.localId === localId)) {
          setPendingProgress(localId, percent)
        }
      },
      !!encrypted
    )
    if (encrypted) applyLocalFileEnvelope(message, encrypted.meta)
    removePendingUpload(localId)
    clearReply()
    sendTypingStop(chatId)
    messages.value = appendMessage(messages.value, message)
    await Promise.all([loadPinned(chatId), loadChats()])
    scrollToBottom()
  } catch (error) {
    removePendingUpload(localId)
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

// ---------- Очередь сообщений, которые не ушли из-за сети ----------
/** Сообщения текущего пользователя, ждущие связи (или уже отвергнутые сервером). */
const outboxItems = ref<OutboxItem[]>([])
/** Id, которые прямо сейчас отправляются (в ленте показываем «Отправка…»). */
const outboxSending = ref<string[]>([])
let outboxTimer: ReturnType<typeof setInterval> | undefined

const reloadOutbox = () => {
  outboxItems.value = readOutbox(currentUserId.value)
}

// В ленте показываем только сообщения открытого чата: у остальных чатов своё.
const openChatOutboxRows = computed<PendingRow[]>(() => {
  const chatId = selectedChatId.value
  if (chatId === null) return []
  return outboxItems.value
    .filter((item) => item.chatId === chatId)
    .map((item) => ({
      localId: item.localId,
      label: item.text,
      status: outboxSending.value.includes(item.id)
        ? 'sending'
        : item.state === 'error'
          ? 'failed'
          : 'queued',
      error: item.error ?? null
    }))
})

/** Строки под лентой: загружаемые вложения + очередь сообщений. */
const threadPendingRows = computed<PendingRow[]>(() => [
  ...pendingUploads.value.map((item) => ({ ...item, status: 'sending' as const })),
  ...openChatOutboxRows.value
])

/**
 * Собрать текст для отправки: в «зашифрованном» чате шифруем в момент отправки
 * (в очереди текст лежит открытым — ключи могут появиться позже).
 */
const buildWireText = async (
  chatId: number,
  text: string
): Promise<{ wireText: string; encrypted: boolean }> => {
  let wireText = text
  let encrypted = false
  const chat = chats.value.find((item) => item.id === chatId) ?? null
  const aes = await chatKeyOf(chat)
  if (aes) {
    wireText = await encryptText(aes, text)
    encrypted = true
  }
  return { wireText, encrypted }
}

/** Поставить сообщение в очередь (связь пропала во время отправки). */
const queueOutgoingText = (chatId: number, text: string, replyToId?: number | null) => {
  const uid = currentUserId.value
  const item: OutboxItem = {
    id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    localId: nextOutboxLocalId(outboxItems.value),
    chatId,
    text,
    replyToId: replyToId ?? null,
    createdAt: new Date().toISOString(),
    state: 'queued'
  }
  addOutboxItem(uid, item)
  reloadOutbox()
}

/**
 * Отправить всё, что накопилось без сети.
 *
 * `onlyId` — повтор одного конкретного сообщения (кнопка «Повторить»).
 */
const flushOutbox = async (onlyId?: string) => {
  const uid = currentUserId.value
  if (uid === null) return
  const items = outboxItems.value.filter((item) => !onlyId || item.id === onlyId)
  for (const item of items) {
    if (!onlyId && !navigator.onLine) return
    outboxSending.value = [...outboxSending.value, item.id]
    try {
      const { wireText, encrypted } = await buildWireText(item.chatId, item.text)
      const message = await sendNewMessage(item.chatId, wireText, item.replyToId, encrypted)
      if (encrypted) {
        message.text = item.text
        message.encrypted = false
      }
      removeOutboxItem(uid, item.id)
      reloadOutbox()
      if (selectedChatId.value === item.chatId) {
        messages.value = appendMessage(messages.value, message)
        void loadPinned(item.chatId)
        void nextTick(scrollToBottom)
      }
      await loadChats()
    } catch (error) {
      if (isNetworkError(error)) {
        // Сеть снова пропала — оставляем в очереди и выйдем из цикла: остальные
        // сообщения тоже не уйдут.
        patchOutboxItem(uid, item.id, { state: 'queued', error: undefined })
        reloadOutbox()
        return
      }
      patchOutboxItem(uid, item.id, {
        state: 'error',
        error: getErrorMessage(error, 'Не удалось отправить')
      })
      reloadOutbox()
    } finally {
      outboxSending.value = outboxSending.value.filter((id) => id !== item.id)
    }
  }
}

/** Повтор одного сообщения из очереди (кнопка в ленте). */
const retryOutboxItem = (localId: number) => {
  const item = outboxItems.value.find((entry) => entry.localId === localId)
  if (item) void flushOutbox(item.id)
}

/** Убрать неотправленное сообщение из очереди. */
const dropOutboxItem = (localId: number) => {
  const item = outboxItems.value.find((entry) => entry.localId === localId)
  if (!item) return
  removeOutboxItem(currentUserId.value, item.id)
  reloadOutbox()
}

// ---------- Автоотправка очереди, когда связь вернулась ----------
/** Раз в 20 секунд пробуем дослать то, что застряло (если браузер думает, что сеть есть). */
const OUTBOX_RETRY_MS = 20_000

const onNetworkOnline = () => {
  void flushOutbox()
}

const startOutboxTimer = () => {
  if (outboxTimer !== undefined) return
  outboxTimer = window.setInterval(() => {
    if (outboxItems.value.length === 0) return
    void flushOutbox()
  }, OUTBOX_RETRY_MS)
}

watch(
  currentUserId,
  (uid) => {
    reloadOutbox()
    if (uid !== null && outboxItems.value.length > 0) void flushOutbox()
  },
  { immediate: true }
)

// ---------- Мультивыделение сообщений (long-press; как в чатах) ----------
/** Активен ли режим выбора сообщений в открытом чате. */
const msgSelectionMode = ref(false)
/** Id выбранных сообщений. */
const selectedMessageIds = ref<number[]>([])

const selectedMessagesOf = (): Message[] =>
  messages.value.filter((m) => selectedMessageIds.value.includes(m.id))

/**
 * Вход в любой режим выделения (сообщения или чаты) кладёт маркер в историю:
 * системная «назад» тогда выходит из выделения, а не уводит из чата или из
 * приложения. Выход маркер гасит — каким бы способом выделение ни сняли
 * (кнопка «Отмена», действие над выбранным, системное «назад»).
 *
 * `flush: 'sync'` — чтобы реакция на смену была внутри обработчика «назад»
 * (`handlingSystemBack` тогда ещё true, и лишнего шага не будет).
 */
const anySelectionActive = computed(
  () => msgSelectionMode.value || Boolean(sidebarRef.value?.selectionMode)
)
watch(
  anySelectionActive,
  (active, wasActive) => {
    if (active === wasActive) return
    if (active) pushMobileNav()
    else stepBackInApp()
  },
  { flush: 'sync' }
)

/**
 * Экран поверх (модалки, просмотрщик истории, лайтбокс) закрыли ЛЮБЫМ способом —
 * крестиком, кликом по фону, жестом. Гасим маркер истории: иначе следующее
 * системное «назад» потратится на пустой шаг («назад не работает»).
 */
const overlayOpen = computed(
  () =>
    showProfileModal.value ||
    showChatInfoModal.value ||
    showGroupInfoModal.value ||
    showCreateGroupModal.value ||
    openStoryId.value !== null ||
    lightboxIndex.value !== null
)
watch(
  overlayOpen,
  (open, wasOpen) => {
    if (wasOpen && !open) stepBackInApp()
  },
  { flush: 'sync' }
)

/**
 * На мобильном список и нить — один экран. Если список открыли жестом (drawer),
 * маркер от нити больше не нужен — гасим его, иначе «назад» уйдёт впустую.
 */
watch(
  drawerOpen,
  (open) => {
    if (!open || isDesktop.value) return
    if (drawerOpenedByBack || drawerOpenedBySection) {
      drawerOpenedByBack = false
      drawerOpenedBySection = false
      return
    }
    stepBackInApp()
  },
  { flush: 'sync' }
)

/** Выход из режима выбора сообщений. */
const exitMessageSelection = () => {
  msgSelectionMode.value = false
  selectedMessageIds.value = []
  emojiPickerFor.value = null
}

/** Вход: удержание на сообщении включает режим и выбирает его. */
const startMessageSelection = (message: Message) => {
  if (message.kind === 'call') return
  msgSelectionMode.value = true
  selectedMessageIds.value = [message.id]
  closePopups()
  clearReply()
  if (editingMessage.value) cancelEditing()
  if (forwardSource.value) cancelForward()
}

/** Клик по сообщению в режиме выбора — отметить/снять. */
const toggleMessageSelect = (message: Message) => {
  if (!msgSelectionMode.value || message.kind === 'call') return
  const next = new Set(selectedMessageIds.value)
  if (next.has(message.id)) {
    next.delete(message.id)
  } else {
    next.add(message.id)
  }
  selectedMessageIds.value = Array.from(next)
  if (selectedMessageIds.value.length === 0) exitMessageSelection()
}

/** Выбраны ли все загруженные сообщения (кроме отметок о звонках). */
const allVisibleMessagesSelected = computed<boolean>(() => {
  const selectable = messages.value.filter((m) => m.kind !== 'call')
  return selectable.length > 0 && selectable.every((m) => selectedMessageIds.value.includes(m.id))
})

const toggleSelectAllMessages = () => {
  if (allVisibleMessagesSelected.value) {
    exitMessageSelection()
    return
  }
  selectedMessageIds.value = messages.value.filter((m) => m.kind !== 'call').map((m) => m.id)
}

/**
 * «Переслать» выбранные сообщения — открыть диалог выбора чатов.
 */
const bulkForwardMessages = () => {
  const sources = selectedMessagesOf().filter((m) => m.kind !== 'call')
  if (sources.length === 0) return
  exitMessageSelection()
  cancelEditing()
  closePopups()
  forwardSource.value = sources
}

/** Сохранить все выбранные в «Сохранённые сообщения» (self-чат). */
const bulkSaveMessagesToSelf = async () => {
  const selfChat = chats.value.find((chat) => chat.is_self)
  const current = selectedChat.value
  if (!selfChat || (current !== null && current.is_self)) return
  const targets = selectedMessagesOf().filter((m) => m.kind !== 'call')
  exitMessageSelection()
  if (targets.length === 0) return
  try {
    for (const message of targets) {
      await forwardMessage(message.id, selfChat.id)
    }
    // Обновляем список: «Сохранённые» поднимутся наверх с новым превью.
    await loadChats()
  } catch (error) {
    console.error('Не удалось сохранить сообщения:', getErrorMessage(error))
  }
}

/** Удалить выбранные сообщения (только свои; чужие пропускаем). */
const bulkDeleteMessages = async () => {
  const own = selectedMessagesOf().filter((m) => m.user_id === currentUserId.value)
  if (own.length === 0) {
    exitMessageSelection()
    return
  }
  if (!window.confirm(`Удалить выбранные сообщения (${own.length})?`)) return
  exitMessageSelection()
  for (const message of own) {
    try {
      await deleteMessage(message.id)
      removeMessageFromThread(message.id)
    } catch (error) {
      console.error('Не удалось удалить сообщение:', getErrorMessage(error))
    }
  }
  const chatId = selectedChatId.value
  if (chatId !== null) {
    await Promise.all([loadPinned(chatId), loadChats()])
  }
}

/** Клик по «Переслано от …» — открыть приватный чат с автором оригинала. */
const openForwarderChat = async (message: Message) => {
  const senderId = message.forwarded_from?.sender_id
  if (senderId == null || senderId === currentUserId.value) return
  exitMessageSelection()
  closePopups()
  clearReply()
  if (editingMessage.value) cancelEditing()
  if (forwardSource.value) cancelForward()
  try {
    const chat = await openPrivateChat(senderId)
    upsertChat(chat)
    view.value = 'chats'
    await openChatThread(chat.id)
  } catch (error) {
    console.error('Не удалось открыть чат с автором:', getErrorMessage(error))
  }
}

// ---------- Редактирование / пересылка ----------
const editingMessage = ref<Message | null>(null)
/** Пересылаемое сообщение (одно) или список; пока не null — открыт диалог. */
const forwardSource = ref<Message | Message[] | null>(null)
/** Идёт ли отправка пересылок (блокирует кнопки диалога). */
const forwardBusy = ref(false)

// ---------- Черновики сообщений (автосохранение текста при смене чата) ----------
// Ключ `userId:chatId` — черновики не «перетекают» между аккаунтами устройства.
const DRAFTS_KEY = 'pismo_drafts'
/** Момент последней программной установки текста поля (гасит «печатает…»). */
let lastComposerProgrammaticEdit = 0

const readDrafts = (): Record<string, string> => {
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const writeDrafts = (drafts: Record<string, string>) => {
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // Приватный режим/переполнение — черновик просто не сохранится.
  }
}

/** Черновики текущего пользователя по id чата (для превью в списке диалогов). */
const draftsByChatId = reactive<Record<number, string>>({})

/** Загружает черновики пользователя из localStorage в реактивную карту. */
const syncDraftsFromStorage = (uid: number | null) => {
  for (const key of Object.keys(draftsByChatId)) {
    delete draftsByChatId[Number(key)]
  }
  if (uid === null) return
  const all = readDrafts()
  const prefix = `${uid}:`
  for (const [key, text] of Object.entries(all)) {
    if (key.startsWith(prefix) && text.trim()) {
      const chatId = Number(key.slice(prefix.length))
      if (Number.isFinite(chatId)) draftsByChatId[chatId] = text
    }
  }
}

watch(currentUserId, () => syncDraftsFromStorage(currentUserId.value), {
  immediate: true
})

const draftStorageKey = (chatId: number | null): string | null => {
  const uid = currentUserId.value
  if (uid === null || chatId === null) return null
  return `${uid}:${chatId}`
}

/** Сохраняет набранный текст в черновик чата (в режиме правки не трогаем). */
const saveDraftFor = (chatId: number | null) => {
  const key = draftStorageKey(chatId)
  if (key === null || editingMessage.value !== null) return
  const text = newMessage.value
  const drafts = readDrafts()
  if (text.trim()) {
    drafts[key] = text
    if (chatId !== null) draftsByChatId[chatId] = text
  } else {
    delete drafts[key]
    if (chatId !== null) delete draftsByChatId[chatId]
  }
  writeDrafts(drafts)
  scheduleDraftPush(chatId, text)
}

/** Черновик чата (пустая строка, если его нет). */
const loadDraftFor = (chatId: number | null): string => {
  const key = draftStorageKey(chatId)
  if (key === null) return ''
  return readDrafts()[key] ?? ''
}

/** Удаляет черновик чата (после фактической отправки). */
const clearDraftFor = (chatId: number | null) => {
  const key = draftStorageKey(chatId)
  if (key === null) return
  const drafts = readDrafts()
  if (key in drafts) {
    delete drafts[key]
    writeDrafts(drafts)
  }
  if (chatId !== null) delete draftsByChatId[chatId]
  scheduleDraftPush(chatId, '')
}

// ---------- Черновики на сервере ----------
// Черновик в localStorage живёт только на этом устройстве и теряется при
// переустановке. Дублируем его на сервере: тогда он виден с другого устройства.
// Пишем не на каждую букву, а с задержкой — API не должен дёргаться на каждый
// символ.
const DRAFT_PUSH_DELAY_MS = 1500

/** Отложенные отправки черновиков: id чата → таймер. */
const draftPushTimers = new Map<number, number>()

/** Что уходит на сервер: в зашифрованном чате — шифротекст (сервер его не читает). */
const pushDraftToServer = async (chatId: number, text: string) => {
  try {
    if (!text.trim()) {
      await deleteDraft(chatId)
      return
    }
    const chat = chats.value.find((item) => item.id === chatId) ?? null
    const wire = chat?.e2ee_enabled ? await buildWireText(chatId, text) : null
    await putDraft(chatId, wire ? wire.wireText : text)
  } catch (error) {
    // Сеть пропала — черновик остался в localStorage и уйдёт при следующем наборе.
    console.error('Не удалось сохранить черновик:', getErrorMessage(error))
  }
}

/** Отложить отправку черновика чата (повторный вызов сдвигает таймер). */
const scheduleDraftPush = (chatId: number | null, text: string) => {
  if (chatId === null || currentUserId.value === null) return
  const existing = draftPushTimers.get(chatId)
  if (existing !== undefined) window.clearTimeout(existing)
  draftPushTimers.set(
    chatId,
    window.setTimeout(() => {
      draftPushTimers.delete(chatId)
      void pushDraftToServer(chatId, text)
    }, DRAFT_PUSH_DELAY_MS)
  )
}

/** Отправить всё отложенное сейчас (уход со страницы, смена чата). */
const flushDraftPushes = () => {
  for (const [chatId, timer] of draftPushTimers) {
    window.clearTimeout(timer)
    const text = draftsByChatId[chatId] ?? ''
    void pushDraftToServer(chatId, text)
  }
  draftPushTimers.clear()
}

/**
 * Подтянуть черновики с сервера.
 *
 * Сервер — источник правды (черновик мог быть набран на другом устройстве), но
 * локальные черновики чатов, которых на сервере нет, не трогаем: они могли не
 * успеть уйти. Черновик зашифрованного чата без ключа просто пропускаем.
 */
const syncDraftsFromServer = async () => {
  const uid = currentUserId.value
  if (uid === null) return
  try {
    const list = await fetchDrafts()
    const local = readDrafts()
    for (const item of list) {
      let text = item.text
      if (isEncryptedPayload(text)) {
        const chat = chats.value.find((entry) => entry.id === item.chat_id) ?? null
        const key = await chatKeyOf(chat)
        const plain = key ? await decryptText(key, text) : null
        if (plain === null) continue
        text = plain
      }
      draftsByChatId[item.chat_id] = text
      local[`${uid}:${item.chat_id}`] = text
    }
    writeDrafts(local)
  } catch (error) {
    console.error('Не удалось загрузить черновики:', getErrorMessage(error))
  }
}

/** Программно ставит текст поля — не считается «набором текста» для собеседника. */
const setComposerText = (text: string) => {
  lastComposerProgrammaticEdit = Date.now()
  newMessage.value = text
}

/** Сохраняет черновик текущего чата (вызывается при перезагрузке/закрытии). */
const handleBeforeUnload = () => {
  saveDraftFor(selectedChatId.value)
  // Черновик пишется на сервер с задержкой — на уходе отправляем сразу.
  flushDraftPushes()
  // Сигнальный канал звонка закрываем сразу: у человека может быть несколько
  // устройств, и уходящая страница не должна получать сигналинг за него.
  callStore.detachSignaling()
  // Сразу сообщаем, что уходим: иначе собеседник ещё минуту видит «в сети»,
  // пока сервер не решит, что канал молчит (см. heartbeat в realtime-сторе).
  realtimeStore.sayGoodbye()
}

/**
 * Свёрнутое/закрытое приложение — тоже момент ухода: черновик успевает уйти
 * на сервер, пока страница ещё жива.
 */
const handleVisibilityForDrafts = () => {
  if (document.hidden) flushDraftPushes()
}

/**
 * Присутствие: «в сети» — это когда человек смотрит в приложение.
 *
 * Свёрнутое приложение остаётся на связи (сообщения приходят), но собеседник не
 * должен видеть «в сети» у того, кто ушёл в другое приложение или закрыл
 * телефон — иначе получается «он вышел, а он всё ещё онлайн».
 */
const handleVisibilityForPresence = () => {
  if (document.hidden) realtimeStore.scheduleAway()
  else realtimeStore.reportPresence()
}

/** Название чата для модалки удаления. */
const chatDeleteLabel = (chat: Chat): string => {
  const peer = otherUserOfChat(chat)
  return chat.users.length === 2 && peer ? displayName(peer) : chat.name
}

// ---------- Модалка «Удалить чат» (для себя / для всех) ----------
const showDeleteChatModal = ref(false)
const deleteChatTarget = ref<Chat | null>(null)
const deleteChatBulkIds = ref<number[]>([])
const deleteChatScope = ref<'me' | 'all'>('me')

const deleteChatTitle = computed<string>(() =>
  deleteChatTarget.value ? chatDeleteLabel(deleteChatTarget.value) : ''
)

/** Открывает модалку удаления (вместо window.confirm). */
const openDeleteChatModal = (chat: Chat) => {
  if (chat.is_self) return // «Сохранённые сообщения» удалить нельзя
  deleteChatTarget.value = chat
  deleteChatBulkIds.value = []
  deleteChatScope.value = 'me'
  showDeleteChatModal.value = true
}

/** Удаление нескольких выбранных чатов (режим выделения). */
const openBulkDeleteChats = (chatIds: number[]) => {
  const ids = chatIds.filter((id) => !chats.value.find((item) => item.id === id)?.is_self)
  if (ids.length === 0) return
  deleteChatTarget.value = null
  deleteChatBulkIds.value = ids
  deleteChatScope.value = 'me'
  showDeleteChatModal.value = true
}

/** Локальная чистка после удаления чата (список/черновик/пин/открытый тред). */
const removeDeletedChat = (chat: Chat) => {
  chats.value = chats.value.filter((item) => item.id !== chat.id)
  clearDraftFor(chat.id)
  if (pinnedChatIds.value.includes(chat.id)) toggleChatPinned(chat.id)
  // Mute снимается на сервере самим удалением/выходом из чата.
  if (selectedChatId.value === chat.id) {
    selectedChatId.value = null
    syncChatUrl(null)
    messages.value = []
    pinnedMessages.value = []
    highlightedMessageId.value = null
    closeLightbox()
    showChatInfoModal.value = false
    showGroupInfoModal.value = false
  }
}

// ---------- Группы: создание/обновление/удаление ----------
/** Группа создана — открываем её чат. */
const onGroupCreated = async (chat: Chat) => {
  showCreateGroupModal.value = false
  upsertChat(chat)
  view.value = 'chats'
  await openChatThread(chat.id)
}

/** Название/аватар/состав группы изменились — обновляем список чатов. */
const onGroupInfoUpdated = async () => {
  await loadChats()
}

/** Пользователь покинул группу или удалил её (действие из карточки группы). */
const onGroupLeft = () => {
  const chat = selectedChat.value
  showGroupInfoModal.value = false
  if (chat) removeDeletedChat(chat)
}

/** Удалён из группы по realtime-событию (chat.removed). */
const handleChatRemoved = (chatId: number) => {
  const chat = chats.value.find((item) => item.id === chatId)
  if (chat) removeDeletedChat(chat)
  else chats.value = chats.value.filter((item) => item.id !== chatId)
  showGroupInfoModal.value = false
}

/** Подтверждение из модалки: удалить «только у меня» или «для всех». */
const confirmDeleteChat = async () => {
  const ids = deleteChatBulkIds.value.length
    ? deleteChatBulkIds.value
    : deleteChatTarget.value
      ? [deleteChatTarget.value.id]
      : []
  if (ids.length === 0) return
  showDeleteChatModal.value = false
  const targets = ids
    .map((id) => chats.value.find((item) => item.id === id))
    .filter((chat): chat is Chat => chat !== undefined)
  deleteChatTarget.value = null
  deleteChatBulkIds.value = []
  const forAll = deleteChatScope.value === 'all'
  try {
    for (const chat of targets) {
      await deleteChat(chat.id, forAll)
      removeDeletedChat(chat)
    }
  } catch (error) {
    console.error('Не удалось удалить чаты:', getErrorMessage(error))
  }
}

const startEditMessage = (message: Message) => {
  if (!isOwnMessage(message)) return
  clearReply()
  cancelForward()
  // Набранный текст не теряем: перед входом в режим правки убираем его в черновик.
  if (selectedChatId.value !== null && newMessage.value.trim()) {
    saveDraftFor(selectedChatId.value)
  }
  editingMessage.value = message
  setComposerText(message.text || '')
}

const cancelEditing = () => {
  editingMessage.value = null
  newMessage.value = ''
}

/** Открывает диалог «Переслать»: пользователь сам выбирает чаты списком. */
const openForward = (message: Message) => {
  cancelEditing()
  closePopups()
  forwardSource.value = message
}

const cancelForward = () => {
  forwardSource.value = null
  forwardBusy.value = false
}

/** Пересылает одно/несколько сообщений в выбранные чаты. */
const sendForward = async (chatIds: number[]) => {
  const value = forwardSource.value
  const sources = value ? (Array.isArray(value) ? value : [value]) : []
  if (sources.length === 0 || chatIds.length === 0) return
  forwardBusy.value = true
  try {
    for (const targetChatId of chatIds) {
      for (const source of sources) {
        const sent = await forwardMessage(source.id, targetChatId)
        if (selectedChatId.value === targetChatId) {
          messages.value = appendMessage(messages.value, sent)
        }
      }
      sendTypingStop(targetChatId)
      if (selectedChatId.value === targetChatId) {
        await loadPinned(targetChatId)
      }
    }
    // Обновляем список: пересланные чаты поднимутся наверх с новым превью.
    await loadChats()
    cancelForward()
  } catch (error) {
    console.error('Не удалось переслать сообщения:', getErrorMessage(error))
    cancelForward()
  } finally {
    forwardBusy.value = false
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
  threadRef.value?.reveal(messageId)
  highlightTimer = window.setTimeout(() => {
    highlightedMessageId.value = null
  }, 2400)
}

// ---------- Поиск по сообщениям ----------
const toggleInlineSearch = () => {
  inlineSearchOpen.value = !inlineSearchOpen.value
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
  threadRef.value?.reveal(messageId)
  highlightTimer = window.setTimeout(() => {
    highlightedMessageId.value = null
  }, 2400)
}

/** Глобальный поиск: открыть чат и перейти (с подсветкой) к найденному сообщению. */
const openGlobalMessage = async (chatId: number, messageId: number) => {
  await openChatThread(chatId)
  // Если сообщения нет в загруженной порции — догружаем более старые.
  if (!messages.value.some((m) => m.id === messageId)) {
    for (let i = 0; i < 40 && !noMoreOlder.value; i += 1) {
      await loadOlderMessages()
      if (messages.value.some((m) => m.id === messageId)) break
    }
  }
  await revealMessageInThread(messageId)
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
}

const toggleExtras = () => {
  extrasPanel.value = extrasPanel.value === 'none' ? extrasTab.value : 'none'
}

const setExtrasTab = (tab: 'emoji' | 'gif') => {
  extrasTab.value = tab
  extrasPanel.value = tab
}

// GIF создаётся фоновым воркером (бэкенд отвечает 202), а свои message.new
// сервер не пушит — поэтому отправитель коротко опрашивает тред, пока GIF не
// появится (потом вступает обычный fallback-опрос 20 с).
const GIF_POLL_INTERVAL_MS = 1000
const GIF_POLL_MAX_ATTEMPTS = 15

const onGifSent = () => {
  // Задача поставлена в очередь (202): сообщение пока не создано — не добавляем
  // в ленту «пустышку». Воркер скачает GIF и создаст сообщение; здесь лишь
  // закрываем панель, сбрасываем ответ/печать и коротко ждём появления GIF.
  extrasPanel.value = 'none'
  clearReply()
  const chatId = selectedChatId.value
  if (chatId === null) return
  sendTypingStop(chatId)

  const beforeMaxId = messages.value.reduce((max, m) => Math.max(max, m.id), 0)
  let attempts = 0
  const pollForGif = async () => {
    if (chatId !== selectedChatId.value) return
    attempts += 1
    try {
      await mergeThreadLatest(chatId)
    } catch {
      // одиночный сбой опроса не критичен — попробуем ещё раз
    }
    const currentMaxId = messages.value.reduce((max, m) => Math.max(max, m.id), 0)
    if (currentMaxId <= beforeMaxId && attempts < GIF_POLL_MAX_ATTEMPTS) {
      window.setTimeout(() => void pollForGif(), GIF_POLL_INTERVAL_MS)
    }
  }
  window.setTimeout(() => void pollForGif(), GIF_POLL_INTERVAL_MS)
  void loadPinned(chatId)
  void loadChats()
}

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
    if (isChatGoneError(error)) {
      // Чат удалили или нас исключили из группы: дальше обновлять нечего, а
      // «висящий» открытый чат с ошибками в консоли только путает.
      dropChat(chatId)
      return
    }
    console.error('Не удалось обновить сообщения:', getErrorMessage(error))
  }
}

/** Убирает чат из локального списка и закрывает его, если он был открыт. */
const dropChat = (chatId: number) => {
  chats.value = chats.value.filter((chat) => chat.id !== chatId)
  if (selectedChatId.value === chatId) closeOpenChat()
}

// Оркестрация (таймеры/события) вынесена в composable.
// ---------- Уведомления о новых сообщениях + счётчик в заголовке вкладки ----------
const BASE_DOC_TITLE = 'Pismo — мессенджер'

const totalUnread = computed(() =>
  chats.value.reduce((sum, chat) => sum + (chat.unread_count || 0), 0)
)

watch(
  totalUnread,
  (count) => {
    document.title = count > 0 ? `(${count}) ${BASE_DOC_TITLE}` : BASE_DOC_TITLE
    // То же число — на иконке установленного приложения (Badging API).
    void setAppBadge(count)
  },
  { immediate: true }
)

// Всплывающие уведомления — ТОЛЬКО системные Web Push (service worker).
// In-app «тостов» нет: пока приложение открыто, сообщения и так видны в ленте
// (плюс счётчик непрочитанных в заголовке вкладки и бейджи), а когда оно
// свёрнуто/закрыто — приходит системный push. В замьюченные чаты push не
// отправляется (см. сервер, таблица chat_mutes).

/**
 * Озвучивание входящих сообщений для скринридеров.
 *
 * Всплывающих уведомлений внутри приложения нет (только системный push), и «ровный»
 * интерфейс для незрячего пользователя молчит: он не узнаёт, что пришло сообщение.
 * Пишем это в скрытую область с `aria-live`.
 */
const liveAnnouncement = ref('')
let announcementTimer: ReturnType<typeof setTimeout> | undefined

const announceIncomingMessage = (chatId: number) => {
  // В открытом чате сообщение и так видно — не мешаем лишней речью.
  if (chatId === selectedChatId.value && !document.hidden) return
  const chat = chats.value.find((item) => item.id === chatId)
  const who = chat ? chatTitle(chat, currentUserId.value) : ''
  liveAnnouncement.value = who ? `Новое сообщение: ${who}` : 'Новое сообщение'
  if (announcementTimer !== undefined) window.clearTimeout(announcementTimer)
  // Сбрасываем текст, иначе следующее такое же сообщение не произнесётся.
  announcementTimer = window.setTimeout(() => {
    liveAnnouncement.value = ''
    announcementTimer = undefined
  }, 4000)
}

const { start: startRealtime, stop: stopRealtime } = useRealtimeSync({
  isAuthenticated: () => authStore.isAuthenticated,
  isMe: (userId) => userId === currentUserId.value,
  getSelectedChatId: () => selectedChatId.value,
  onPresence: applyPresence,
  onTyping: markPeerTyping,
  onTypingStop: clearPeerTyping,
  onChatsSync: refreshChatsQuiet,
  onThreadSync: refreshOpenThreadQuiet,
  onMessageNew: announceIncomingMessage,
  onChatRemoved: handleChatRemoved
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
  // Программная установка (восстановление черновика/правка) не шлёт «печатает…».
  if (Date.now() - lastComposerProgrammaticEdit < 500) return
  const now = Date.now()
  if (now - lastTypingSentAt >= TYPING_SEND_INTERVAL_MS) {
    lastTypingSentAt = now
    realtimeStore.send({ type: 'typing', chat_id: chatId })
  }
})

// ---------- Навигация ----------
/** Открывает раздел историй (статусов). */
const openStories = () => switchSection('stories')

/** Открывает полноэкранный просмотр истории. */
const openStory = (storyId: number) => {
  pushMobileNav()
  openStoryId.value = storyId
}

const openContacts = () => switchSection('contacts')

/** Закрывает открытую переписку (на мобильном список и нить — один экран). */
const closeOpenChat = () => {
  selectedChatId.value = null
  messages.value = []
  pinnedMessages.value = []
  syncChatUrl(null)
}

/** Переключение раздела по нижнему меню — всегда прямой переход. */
const switchSection = (section: Section) => {
  if (isDesktop.value) {
    if (view.value === section) return
    view.value = section
  } else {
    // На мобильном разделы (Чаты/Истории/Контакты) живут в drawer'е. Если он
    // закрыт (человек на заглушке «Выберите, кому хотели бы написать») и мы
    // просто меняем `view`, переход происходит «невидимо» — кнопка «Открыть
    // контакты» как будто не работает. Поэтому всегда показываем список.
    if (view.value === section && drawerOpen.value) return
    if (view.value !== section) {
      pushMobileNav(section)
      view.value = section
    }
    // Уходя из переписки в раздел, закрываем её: иначе в адресе останется
    // `?chat=`, и после обновления страница вернётся в чат, хотя человек был в
    // разделе — «обновление открывает не ту страницу».
    closeOpenChat()
    revealDrawer()
  }
  if (section === 'stories') void storiesStore.load()
}

// Любая смена раздела (в т. ч. прямой вызов view.value) сразу запоминается.
watch(view, (section) => storeSection(section))

const goToChats = () => switchSection('chats')

const goToProfile = () => {
  // Профиль всегда открывается списком разделов — если в прошлый раз был
  // открыт конкретный раздел, возвращаемся к списку.
  profileRef.value?.backToSections()
  pushMobileNav()
  showProfileModal.value = true
}

/** Закрытие профиля: сбрасываем раздел (следующее открытие — со списка). */
const onProfileHidden = () => {
  showProfileModal.value = false
  profileRef.value?.backToSections()
}

/** Из профиля перешли в «Внешний вид» (это отдельный диалог). */
const onLoginModalClose = () => {
  console.log('Login modal close event received. Closing modal.')
  showLoginModal.value = false
}

// ---------- Жизненный цикл ----------
const ready = computed(() => authStore.isAuthenticated && currentUserId.value !== null)

/** Черновики тянем один раз за сессию — когда чаты загружены (нужны ключи E2EE). */
const draftsSynced = ref(false)
watch(
  [ready, () => chats.value.length],
  ([isReady, chatCount]) => {
    if (!isReady || chatCount === 0 || draftsSynced.value) return
    draftsSynced.value = true
    void syncDraftsFromServer()
  },
  { immediate: true }
)

// ---------- Запуск из уведомления о звонке ----------
// Приложение открыли тапом по push «Вам звонят…» (?call=<id>&peer=<uid>).
// Пока сигнальный WS не доставит припаркованный offer, показываем
// полноэкранный «Входящий звонок…», чтобы не «моргал» список чатов.
// Если offer так и не пришёл (вызов сброшен/истёк) — «Вызов завершён».
type CallLaunchScreen = 'none' | 'ring' | 'missed'
const callLaunch = ref<{ callId: string; peerId: number; action?: string } | null>(null)
const callLaunchScreen = ref<CallLaunchScreen>('none')
/** Нажали «Ответить» на экране ожидания — offer ещё не пришёл, ждём его. */
const callLaunchAnswering = ref(false)
let callLaunchTimer: ReturnType<typeof setTimeout> | undefined
let callLaunchVerifyTimer: ReturnType<typeof setTimeout> | undefined
// Ждём припаркованный offer: собеседник мог открыть приложение из push,
// для этого нужно время на загрузку и подключение WebSocket.
const CALL_LAUNCH_WAIT_MS = 25_000
// Через сколько проверить у сервера, ждёт ли вызов ещё (см. verifyPendingCall).
// Даём сигнальному каналу время подключиться и забрать offer из парковки.
const CALL_LAUNCH_VERIFY_MS = 3000
// Действие из push-уведомления, ожидающее доставки offer (см. watcher'ы ниже).
let autoAnswerPending = false
let autoDeclinePending = false
/**
 * Чат, который нужно открыть после входа (запуск из уведомления при истёкшей
 * сессии). Живёт только в памяти страницы: между запусками чат не помним —
 * приложение всегда открывается на главной.
 */
let pendingChatAfterLogin: number | null = null

/** Имя собеседника для экрана «Входящий звонок…». */
const callLaunchPeerName = computed<string>(() => {
  const peerId = callLaunch.value?.peerId
  if (peerId === undefined) return ''
  const peer = findPeerUser(peerId)
  return peer ? displayName(peer) : ''
})

const stopCallLaunchScreen = () => {
  callStore.stopRinging()
  callLaunchScreen.value = 'none'
  callLaunchAnswering.value = false
  if (callLaunchTimer !== undefined) {
    window.clearTimeout(callLaunchTimer)
    callLaunchTimer = undefined
  }
  if (callLaunchVerifyTimer !== undefined) {
    window.clearTimeout(callLaunchVerifyTimer)
    callLaunchVerifyTimer = undefined
  }
}

/**
 * Проверяет, ждёт ли этот звонок ещё ответа.
 *
 * Экран «Входящий звонок…» открывается по уведомлению, пока вызов лежит в
 * парковке на сервере. Уведомление может быть устаревшим: звонок давно
 * отклонили, ответили на другом устройстве или зовущий его отменил. Тогда
 * парковки уже нет — закрываем экран сразу, а не через 25 секунд ожидания.
 */
const verifyPendingCall = async (callId: string) => {
  const pending = await isCallStillPending(callId)
  // null — не знаем (нет сети): не мешаем человеку, работает обычное ожидание.
  if (pending !== false) return
  // Пока спрашивали, вызов мог дойти своим ходом — тогда экран уже не наш.
  if (callStore.status !== 'idle') return
  if (callLaunch.value?.callId !== callId) return
  callLaunch.value = null
  stopCallLaunchScreen()
  callStore.notice = 'Звонок завершён'
}

const showCallLaunchRing = () => {
  if (!callLaunch.value) return
  const launch = callLaunch.value
  callLaunchScreen.value = 'ring'
  // Звук с самого открытия, пока WS не доставит offer (дальше стор сам звонит).
  callStore.ringIncoming()
  if (callLaunchVerifyTimer !== undefined) window.clearTimeout(callLaunchVerifyTimer)
  callLaunchVerifyTimer = window.setTimeout(() => {
    callLaunchVerifyTimer = undefined
    void verifyPendingCall(launch.callId)
  }, CALL_LAUNCH_VERIFY_MS)
  if (callLaunchTimer !== undefined) window.clearTimeout(callLaunchTimer)
  callLaunchTimer = window.setTimeout(() => {
    if (callLaunchScreen.value !== 'ring') return
    callLaunchScreen.value = 'missed'
    callStore.stopRinging()
    autoAnswerPending = false
    autoDeclinePending = false
    callLaunchAnswering.value = false
    callLaunchTimer = window.setTimeout(() => {
      callLaunchScreen.value = 'none'
      callLaunch.value = null
      callLaunchTimer = undefined
    }, 3500)
  }, CALL_LAUNCH_WAIT_MS)
}

/** Пользователь сам закрыл экран «Входящий звонок…» (до доставки offer). */
const dismissCallLaunch = () => {
  const launch = callLaunch.value
  if (launch) callStore.declineCallTo(launch.peerId, launch.callId)
  autoAnswerPending = false
  autoDeclinePending = false
  callLaunchAnswering.value = false
  callLaunch.value = null
  stopCallLaunchScreen()
}

/**
 * Нажали «Ответить» на экране ожидания (offer ещё в пути).
 *
 * Отвечать пока нечем — SDP собеседника придёт с припаркованным offer'ом. Но
 * желание человека уже известно: как только offer доставят, `acceptCall()`
 * выполнится сам (см. watcher статуса). Иначе зовущий ждал бы таймаут, хотя
 * «Ответить» уже нажали — и это выглядело бы как отказ.
 */
const answerCallLaunch = () => {
  if (callLaunchAnswering.value) return
  callLaunchAnswering.value = true
  autoAnswerPending = true
  autoDeclinePending = false
}

/**
 * Применяет «запуск из уведомления о звонке»: экран ожидания offer и действие
 * из push («Ответить»/«Отклонить»).
 *
 * Нужна отдельно от watcher'а готовности, потому что готовность и запуск
 * приходят в разном порядке: при холодном старте сессия восстанавливается из
 * localStorage сразу, поэтому `ready` уже true к моменту разбора адреса
 * — раньше действие «Ответить» из уведомления в таком случае терялось, и
 * звонок приходилось принимать вручную (зовущий всё это время слышал гудки).
 */
const applyCallLaunch = () => {
  const launch = callLaunch.value
  if (!launch || !ready.value) return
  const wanted = launch.action === 'answer' || launch.action === 'decline' ? launch.action : 'focus'
  // Offer мог прийти раньше, чем мы обработали запуск: тогда watcher статуса
  // уже не сработает, поэтому действие выполняем сразу.
  if (callStore.status === 'incoming') {
    callLaunch.value = null
    callLaunchScreen.value = 'none'
    if (callLaunchTimer !== undefined) {
      window.clearTimeout(callLaunchTimer)
      callLaunchTimer = undefined
    }
    if (wanted === 'answer') void callStore.acceptCall()
    else if (wanted === 'decline') callStore.declineCall()
    return
  }
  if (callStore.status !== 'idle') return
  if (wanted === 'decline') {
    // «Отклонить» — без экрана: ждём доставки offer и отклоняем (см. watcher).
    autoDeclinePending = true
    // Через окно ожидания флаг снимаем: иначе он выстрелил бы на следующем
    // звонке (offer по отклонённому вызову уже не придёт).
    if (callLaunchTimer !== undefined) window.clearTimeout(callLaunchTimer)
    callLaunchTimer = window.setTimeout(() => {
      callLaunchTimer = undefined
      autoDeclinePending = false
      callLaunch.value = null
    }, CALL_LAUNCH_WAIT_MS)
    return
  }
  autoAnswerPending = wanted === 'answer'
  showCallLaunchRing()
}

/**
 * Запускает экран входящего звонка по данным уведомления (адрес `?call=…`,
 * нативная оболочка Android, push). Приложение может быть полностью закрыто:
 * сам вызов уже ждёт в парковке на сервере (см. `calls.park_offer`).
 */
const beginCallLaunch = (
  callId: string,
  peerId: number,
  action: 'answer' | 'decline' | 'focus' = 'focus'
) => {
  if (!callId || !peerId) return
  // Звонок уже идёт/звонит — экран ожидания только мешал бы, но действие из
  // уведомления терять нельзя: иначе «Ответить» из push просто ничего не делал
  // бы (звонок у зовущего дотелефонит до таймаута и запишется пропущенным).
  if (callStore.status !== 'idle') {
    if (action === 'answer' && callStore.status === 'incoming') {
      void callStore.acceptCall()
    } else if (action === 'decline' && callStore.status === 'incoming') {
      callStore.declineCall()
    }
    return
  }
  callLaunch.value = { callId, peerId, action }
  applyCallLaunch()
}

// ---------- Ссылка-профиль: https://pismo.space/u/<логин> ----------
// Такую ссылку можно набрать в браузере, переслать в другой мессенджер или
// открыть приложением Android (App Links). Роутер отдаёт её маршруту
// `/u/:username`, а разбор и открытие чата живут здесь: логин превращается в
// личный чат, а адрес сразу становится обычным (`/?chat=<id>`).
const profileLinkUsername = ref<string | null>(
  typeof window === 'undefined' ? null : usernameFromProfilePath(window.location.pathname)
)
let profileLinkResolving = false

/** Открывает чат по ссылке-профилю (после входа и загрузки списка чатов). */
const resolveProfileLink = async () => {
  const username = profileLinkUsername.value
  if (!username || profileLinkResolving) return
  profileLinkResolving = true
  profileLinkUsername.value = null
  // Убираем `/u/<логин>` из адреса: дальше ссылку на открытый чат держит `?chat=`
  // (иначе путь остался бы вида `/u/<логин>?chat=<id>` и после перезагрузки
  // ссылка «открывалась» бы заново).
  try {
    window.history.replaceState(window.history.state, '', '/')
  } catch {
    /* история недоступна (iframe) — адрес просто останется как есть */
  }
  try {
    const target = await fetchUserByUsername(username)
    if (target.id === currentUserId.value) {
      // Ссылка на себя: открываем «Сохранённые сообщения».
      const self = chats.value.find((chat) => chat.is_self)
      if (self) {
        await openChatThread(self.id)
      } else {
        Notify.create({
          message: 'Это ваша ссылка',
          caption: `@${target.username}`,
          timeout: 3000
        })
      }
      return
    }
    const chat = await openPrivateChat(target.id)
    upsertChat(chat)
    view.value = 'chats'
    await openChatThread(chat.id)
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: 'Ссылка не открылась',
      caption: `Логин «${username}» не найден`,
      timeout: 4000
    })
    console.error('Не удалось открыть ссылку-профиль:', getErrorMessage(error))
  } finally {
    profileLinkResolving = false
  }
}

// ---------- «Поделиться» (Android-приложение и PWA) ----------
// Два источника, один путь обработки:
//  * приложение Android — нативная оболочка присылает содержимое событием
//    pismo:share (текст/ссылка/картинка, см. services/nativeShare.ts);
//  * установленная PWA — Chrome открывает страницу с параметрами
//    title/text/url (share_target в манифесте, см. utils/shareTarget.ts).
// Дальше одинаково: выбираем чат в диалоге и отправляем.
const nativeShare = ref<NativeShareDescriptor | null>(null)
const nativeShareFile = ref<File | null>(null)
const nativeSharePreviewUrl = ref<string | null>(null)
const nativeShareBusy = ref(false)
/** «Поделиться» нажали до входа — придержим, пока человек не войдёт. */
let pendingIncomingShare: NativeShareDescriptor | null = null

/** Сбрасывает состояние диалога (нативную часть не трогает). */
const resetNativeShareState = () => {
  if (nativeSharePreviewUrl.value) URL.revokeObjectURL(nativeSharePreviewUrl.value)
  nativeSharePreviewUrl.value = null
  nativeShareFile.value = null
  nativeShare.value = null
}

/** Закрывает диалог и освобождает содержимое в нативной части. */
const discardNativeShare = () => {
  resetNativeShareState()
  clearNativeShare()
}

const cancelNativeShare = () => {
  if (nativeShareBusy.value) return
  discardNativeShare()
}

/** Принимает содержимое «поделиться» и готовит превью. */
const acceptIncomingShare = async (descriptor: NativeShareDescriptor) => {
  if (!authStore.isAuthenticated) {
    pendingIncomingShare = descriptor
    return
  }
  resetNativeShareState()
  nativeShare.value = descriptor
  if (!descriptor.hasFile) return
  if (descriptor.size > MAX_SHARE_FILE_BYTES) {
    Notify.create({
      type: 'warning',
      message: 'Файл слишком большой',
      caption: 'Отправим только текст',
      timeout: 4000
    })
    nativeShare.value = { ...descriptor, hasFile: false, size: 0 }
    return
  }
  try {
    const file = await readNativeShareFile(descriptor)
    if (!file) return
    nativeShareFile.value = file
    if (file.type.startsWith('image/')) {
      nativeSharePreviewUrl.value = URL.createObjectURL(file)
    }
  } catch (error) {
    console.error('Не удалось прочитать присланный файл:', getErrorMessage(error))
  }
}

/**
 * Текст для отправки: в «зашифрованном» чате — шифротекст, если ключи готовы
 * (ровно как при обычной отправке), иначе открытый текст.
 */
const encryptSharedText = async (
  chatId: number,
  text: string
): Promise<{ text: string; encrypted: boolean }> => {
  if (!text) return { text, encrypted: false }
  const chat = chats.value.find((item) => item.id === chatId) ?? null
  const aes = await chatKeyOf(chat)
  if (!aes) return { text, encrypted: false }
  return { text: await encryptText(aes, text), encrypted: true }
}

/** Отправляет принятое содержимое в выбранный чат. */
const sendIncomingShare = async (chatId: number) => {
  const target = nativeShare.value
  if (!target || nativeShareBusy.value) return
  const text = target.text.trim()
  const file = nativeShareFile.value
  if (!text && !file) {
    discardNativeShare()
    return
  }
  nativeShareBusy.value = true
  try {
    if (file) {
      // Фото сжимаем на клиенте — как при обычной отправке вложения.
      const upload = file.type.startsWith('image/') ? await optimizeImageFile(file) : file
      const aes = await chatKeyOf(chats.value.find((item) => item.id === chatId) ?? null)
      const payload = aes ? await encryptFileForChat(aes, upload, text) : null
      const message = await sendAttachmentMessage(
        chatId,
        payload ? payload.blob : upload,
        payload ? payload.text : text,
        undefined,
        undefined,
        !!payload
      )
      if (payload) applyLocalFileEnvelope(message, payload.meta)
    } else {
      const wire = await encryptSharedText(chatId, text)
      await sendNewMessage(chatId, wire.text, undefined, wire.encrypted)
    }
    const chat = chats.value.find((item) => item.id === chatId)
    Notify.create({
      message: 'Отправлено',
      caption: chat ? `В чат «${chatTitle(chat, currentUserId.value)}»` : '',
      timeout: 2500
    })
    await loadChats()
    if (selectedChatId.value === chatId) await refreshThread()
    discardNativeShare()
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: 'Не удалось отправить',
      caption: getErrorMessage(error),
      timeout: 4000
    })
  } finally {
    nativeShareBusy.value = false
  }
}

const disposeNativeShare = initNativeShare((descriptor) => {
  void acceptIncomingShare(descriptor)
})

// «Поделиться» из установленной PWA: Chrome дописал параметры в адрес.
// Забираем их до первой отрисовки и сразу чистим адрес (они длинные и не должны
// попасть в историю); если человек ещё не вошёл — диалог откроется после входа.
const shareTargetPayload = shareTargetFromSearch(
  typeof window === 'undefined' ? '' : window.location.search
)
if (shareTargetPayload) {
  try {
    window.history.replaceState(
      window.history.state,
      '',
      withoutShareTargetParams(window.location.href)
    )
  } catch {
    /* история недоступна — адрес просто останется как есть */
  }
  void acceptIncomingShare({
    text: shareTargetPayload.text,
    subject: '',
    mime: '',
    name: '',
    size: 0,
    hasFile: false
  })
}

watch(
  ready,
  async (isReady) => {
    if (isReady) {
      const uid = currentUserId.value
      e2eeMyKeyReady.value = uid !== null && isE2eeAvailable() ? await bootstrapE2ee(uid) : false
      await Promise.all([loadChats(), loadContacts()])
      // Ссылка-профиль и отложенное «Поделиться» открываются уже после входа
      // и загрузки чатов: иначе некуда было бы открывать/отправлять.
      await resolveProfileLink()
      await resolveInviteLink()
      if (pendingIncomingShare) {
        const held = pendingIncomingShare
        pendingIncomingShare = null
        await acceptIncomingShare(held)
      }
      startRealtime()
      void callStore.connect()
      // Звонок из уведомления: показать экран ожидания и выполнить действие.
      applyCallLaunch()
    } else {
      stopRealtime()
      callStore.disconnect()
      resetE2eeSession()
      releaseDecryptedMedia()
      e2eeMyKeyReady.value = false
      e2eePeerReadyByChat.value = {}
      chats.value = []
      messages.value = []
      pinnedMessages.value = []
      contactsStore.reset()
      selectedChatId.value = null
      syncChatUrl(null)
      showChatInfoModal.value = false
      showGroupInfoModal.value = false
      showCreateGroupModal.value = false
      clearAll()
    }
  },
  { immediate: true }
)

// Push-уведомления: в браузере — Web Push (подписка PWA), в Android-приложении
// из RuStore — RuStore Push. Включено -> подписываемся (повторный вызов безопасен),
// выключено -> отписываемся; при „denied“/„unsupported“ лишний раз не дёргаем API.
const pushOptIn = computed(() => authStore.current_user?.profile?.notifications_enabled ?? true)

const ensurePushState = () => {
  if (!ready.value) return
  if (isNativeApp()) {
    if (pushOptIn.value) {
      enableNativePush()
    } else {
      void disableNativePush()
    }
    return
  }
  if (pushOptIn.value) {
    const permission = getPushPermission()
    if (permission === 'denied' || permission === 'unsupported') return
    void enablePushNotifications()
  } else {
    void disablePushNotifications()
  }
}

watch([ready, pushOptIn], ensurePushState)

// ---------- RuStore Push (Android-приложение из RuStore) ----------
// Нативная оболочка (android/) присылает события: push-токен, статус, данные push
// и цель перехода при клике по уведомлению. В браузере initNativePush() — no-op,
// веб-версия продолжает жить на обычном Web Push.
let disposeNativePush: () => void = () => {}

/** Открывает чат/звонок, по которому тапнули уведомление (данные из push). */
const openNativeTarget = async (data: Record<string, string>) => {
  // Звонок: показываем экран входящего звонка — сам вызов уже ждёт в парковке
  // на сервере и придёт по сигнальному каналу, как только он поднимется.
  const callId = String(data.call_id ?? '')
  const callPeerId = Number(data.peer_id)
  if ((data.type === 'call' || callId) && callId && Number.isFinite(callPeerId) && callPeerId > 0) {
    const action = data.action === 'answer' || data.action === 'decline' ? data.action : 'focus'
    beginCallLaunch(callId, callPeerId, action)
    return
  }
  const chatId = Number(data.chat_id)
  if (!Number.isFinite(chatId) || chatId <= 0) return
  await loadChats()
  await openChatThread(chatId)
}

disposeNativePush = initNativePush({
  onOpenTarget: (data) => {
    void openNativeTarget(data)
  },
  onPushData: (data) => {
    // Приложение открыто — подтягиваем свежие данные вместо системного уведомления.
    void refreshChatsQuiet()
    void refreshOpenThreadQuiet()
    // Звонок: WebView мог быть в фоне и сигнальный канал уже отвалился.
    // Показываем экран входящего звонка — offer ждёт в парковке на сервере.
    if (data.type === 'call' && data.call_id) {
      beginCallLaunch(String(data.call_id), Number(data.peer_id), 'focus')
    }
  }
})

// ---------- Ссылка-приглашение в группу: /j/<токен> ----------
// Ссылку делает создатель или админ группы в карточке группы и отправляет
// другу. Открывший её видит карточку группы и вступает — до этого он в группе
// не состоит, поэтому показываем, КУДА его зовут, и спрашиваем согласие.
const inviteToken = ref<string | null>(
  typeof window === 'undefined' ? null : inviteTokenFromPath(window.location.pathname)
)
/** Токен подтверждённой ссылки: он нужен при нажатии «Войти». */
const inviteJoinToken = ref<string | null>(null)
const invitePreview = ref<GroupInvitePreview | null>(null)
const inviteDialogOpen = ref(false)
const inviteJoining = ref(false)
const inviteJoinError = ref('')
let inviteResolving = false

/**
 * Разбирает ссылку-приглашение (после входа и загрузки чатов).
 *
 * Адрес чистим сразу: `/j/<токен>` — одноразовый, а открытый чат в адресе держит
 * `?chat=` (иначе после перезагрузки ссылка «открывалась» бы заново).
 */
const resolveInviteLink = async () => {
  const token = inviteToken.value
  if (!token || inviteResolving) return
  inviteResolving = true
  inviteToken.value = null
  try {
    window.history.replaceState(window.history.state, '', '/')
  } catch {
    /* история недоступна (iframe) — адрес просто останется как есть */
  }
  try {
    const preview = await fetchGroupInvitePreview(token)
    if (preview.is_member) {
      // Уже в группе — просто открываем чат (ссылка при этом может быть старой).
      if (!chats.value.some((chat) => chat.id === preview.chat_id)) await loadChats()
      await openChatThread(preview.chat_id)
      return
    }
    inviteJoinToken.value = token
    invitePreview.value = preview
    inviteDialogOpen.value = true
    // Диалог — «слой»: системная кнопка «назад» на телефоне должна его закрыть.
    pushMobileNav()
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: 'Приглашение не открылось',
      caption: getErrorMessage(error, 'Ссылка не действует — попросите новую'),
      timeout: 4000
    })
  } finally {
    inviteResolving = false
  }
}

/** Закрывает карточку приглашения, ничего не делая. */
const closeInviteDialog = () => {
  inviteDialogOpen.value = false
  inviteJoinError.value = ''
  inviteJoinToken.value = null
  invitePreview.value = null
}

/** Вступает в группу по подтверждённой ссылке и открывает чат. */
const confirmJoinInvite = async () => {
  const token = inviteJoinToken.value
  if (!token || inviteJoining.value) return
  inviteJoining.value = true
  inviteJoinError.value = ''
  try {
    const result = await joinGroupByInvite(token)
    await loadChats()
    inviteDialogOpen.value = false
    inviteJoinToken.value = null
    invitePreview.value = null
    view.value = 'chats'
    await openChatThread(result.chat_id)
    Notify.create({
      message: `Вы в группе «${result.name}»`,
      timeout: 3000
    })
  } catch (error) {
    inviteJoinError.value = getErrorMessage(error, 'Не удалось войти в группу')
  } finally {
    inviteJoining.value = false
  }
}

// ---------- Модерация: жалобы и блокировка (требования RuStore) ----------

/** Жалоба на собеседника из меню «⋯» в шапке личного чата. */
const openReportForPeer = () => {
  const chat = selectedChat.value
  if (!chat) return
  const peer = chatPeer(chat, currentUserId.value)
  if (!peer) return
  reportTarget.value = { userId: peer.id, userName: displayName(peer), chatId: chat.id }
}

/** Жалоба на конкретное сообщение (из действий сообщения, работает и в группах). */
const openReportForMessage = (message: Message) => {
  const chat = selectedChat.value
  if (!chat || message.user_id === currentUserId.value) return
  const author = chat.users.find((item) => item.id === message.user_id)
  reportTarget.value = {
    userId: message.user_id,
    userName: author ? displayName(author) : 'Пользователь',
    chatId: chat.id,
    messageId: message.id,
    messagePreview: (message.text ?? '').trim().slice(0, 80)
  }
}

/** Блокировка пользователя: диалог скрывается, переписка не доставляется. */
const blockPeer = async (userId: number) => {
  if (userId === currentUserId.value) return
  try {
    await blockUser(userId)
    const chat = selectedChat.value
    if (chat) {
      chats.value = chats.value.filter((item) => item.id !== chat.id)
      selectedChatId.value = null
      syncChatUrl(null)
      messages.value = []
    }
    await refreshChatsQuiet()
    Notify.create({
      message: 'Пользователь заблокирован',
      caption: 'Снять блокировку: «⋯» в списке чатов → «Заблокированные»',
      timeout: 4000
    })
  } catch (error) {
    Notify.create({
      message: getErrorMessage(error, 'Не удалось заблокировать пользователя'),
      color: 'negative',
      timeout: 4000
    })
  }
}

/** Блокировка собеседника открытого чата (событие из шапки). */
const blockSelectedPeer = async () => {
  const chat = selectedChat.value
  const peer = chat ? chatPeer(chat, currentUserId.value) : null
  if (!peer) return
  await blockPeer(peer.id)
}

/** Жалоба отправлена — жалобы разбирают модераторы. */
const onReportSent = () => {
  Notify.create({
    message: 'Жалоба отправлена',
    caption: 'Мы проверим её и примем меры',
    timeout: 3000
  })
}

/** Блокировка снята — диалог снова становится видимым. */
const onBlockedUsersChanged = () => {
  void refreshChatsQuiet()
}

/**
 * Диалог «Новый вход в аккаунт».
 *
 * Показывается, если приложение открыли из push о новом входе (`?security=1`)
 * или пришло сообщение от service worker: у владельца должно быть действие в
 * один тап — завершить чужие сессии или заморозить аккаунт.
 */
const showSecurityAlert = ref(new URLSearchParams(initialSearch).get('security') === '1')

/**
 * Предупреждение о смене ключа шифрования собеседника.
 *
 * Ключ E2EE привязан к устройству: он меняется, когда человек заходит с нового
 * телефона (нормально) — и ровно так же выглядит подмена ключа тем, кто угнал
 * аккаунт и хочет читать чужую переписку. Сервер эти случаи не различает, а
 * человек — да, поэтому спрашиваем его, а не шифруем молча.
 */
const showPeerKeyChanged = ref(false)
const peerKeyChanged = ref<PeerKeyChange | null>(null)
/** Отписка от события E2EE (снимается при уходе с экрана). */
let unsubscribePeerKey: (() => void) | null = null

/** Имя собеседника для текста предупреждения (с учётом моего имени контакта). */
const peerKeyChangedName = computed<string>(() => {
  const change = peerKeyChanged.value
  if (!change) return ''
  const peer = findPeerUser(change.userId)
  return peer ? displayName(peer) : ''
})

/** «Понятно, это его устройство»: запоминаем новый ключ и больше не спрашиваем. */
const acceptChangedPeerKey = () => {
  const change = peerKeyChanged.value
  if (change) acceptPeerKey(change.userId, change.current)
  peerKeyChanged.value = null
}

/** Убираем `?security=1` из адреса, чтобы перезагрузка не открывала диалог снова. */
const clearSecurityParam = () => {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('security')) return
    url.searchParams.delete('security')
    router.options.history.replace(
      `${url.pathname}${url.search}${url.hash}`,
      window.history.state ?? {}
    )
  } catch {
    /* адрес недоступен — не критично */
  }
}

watch(showSecurityAlert, (open) => {
  if (!open) clearSecurityParam()
})

onMounted(async () => {
  await authStore.initializeApp()
  // Истории грузим сразу: точка «есть новое» должна быть видна без захода в раздел.
  if (authStore.isAuthenticated) void storiesStore.load()
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('message', handleWindowMessage)
  window.addEventListener('visibilitychange', handleCallVisibility)
  window.addEventListener('visibilitychange', handleVisibilityForDrafts)
  window.addEventListener('visibilitychange', handleVisibilityForPresence)
  window.addEventListener('popstate', onAppPopState)
  // Связь вернулась — досылаем то, что застряло без сети.
  window.addEventListener('online', onNetworkOnline)
  // Собеседник сменил ключ шифрования — предупреждаем один раз на каждый ключ.
  unsubscribePeerKey = onPeerKeyChanged((change) => {
    peerKeyChanged.value = change
    showPeerKeyChanged.value = true
  })
  startOutboxTimer()
  // Холодный старт: уведомления о звонках прошлых запусков («Вам звонят» о
  // вызове, который давно принят/отклонён/отменён) на экране не оставляем.
  if (callStore.status !== 'incoming') void closeCallRings()
  // Выкатили новую версию — приложение обновится само, когда это безопасно:
  // иначе PWA на телефоне может сутками работать на старом коде.
  watchServiceWorkerUpdate(
    () =>
      callStore.status === 'idle' && callLaunchScreen.value === 'none' && !newMessage.value.trim()
  )
  scrollToBottom()

  // Холодный старт по уведомлению.
  const launchParams = new URLSearchParams(window.location.search)
  const callIdParam = launchParams.get('call')
  const peerIdParam = launchParams.get('peer')
  const actionParam = launchParams.get('action')
  const markReadParam = launchParams.get('markread')
  if (callIdParam && peerIdParam && /^\d+$/.test(peerIdParam)) {
    // Приложение открыли по звонку (?call=<id>&peer=<uid>&action=…). При
    // холодном старте сессия уже восстановлена, поэтому применяем запуск сразу
    // (а не только по watcher'у готовности — он в этом случае не сработает).
    const launchAction =
      actionParam === 'answer' || actionParam === 'decline' ? actionParam : 'focus'
    beginCallLaunch(callIdParam, Number(peerIdParam), launchAction)
    // Звонок открывается поверх, но открытый чат из адреса тоже вернём — иначе
    // после перезагрузки под звонком оказался бы список чатов.
    const chatDuringCall = chatIdFromUrl(window.location.search)
    if (chatDuringCall !== null) void openChatFromPush(chatDuringCall, { pushNav: false })
  } else {
    // Обычная навигация: перезагрузка страницы, когда чат был открыт
    // (`?chat=<id>`, возможно с пометкой «прочитано»), или запуск приложения
    // заново — там адрес `start_url` («/»), и мы остаёмся на главной.
    const chatParam = chatIdFromUrl(window.location.search)
    if (chatParam !== null && markReadParam === '1') {
      void markChatReadQuietly(chatParam)
    } else if (initialChatId !== null) {
      void openChatFromPush(initialChatId, { pushNav: false }).then(() => {
        // Холодный старт по кнопке «Ответить»: чат открыт — ставим курсор в ввод.
        if (replyLaunchRequested) void focusComposer()
      })
    }
  }

  // Страховка: если чат открыть не удалось (нет сети, чат удалён), не держим
  // вечное «Открываю чат…» — через время показываем список чатов.
  if (initialChatId !== null) {
    window.setTimeout(() => {
      const stillLoading =
        selectedChatId.value === initialChatId &&
        !chats.value.some((chat) => chat.id === initialChatId)
      if (stillLoading) abortChatRestore(initialChatId)
    }, 20_000)
  }
})

/** Выход из восстановления чата: показываем список чатов и чистим адрес. */
const abortChatRestore = (chatId: number) => {
  if (selectedChatId.value === chatId) {
    selectedChatId.value = null
    messages.value = []
    drawerOpen.value = true
  }
  syncChatUrl(null)
}

/**
 * Загружает список чатов для восстановления: до трёх попыток при сбое.
 *
 * Три, а не две: сразу после перезагрузки приложения сеть и API могут быть ещё
 * не готовы, и чат из адреса «терялся» — человек оказывался на списке чатов.
 */
const loadChatsForRestore = async (): Promise<boolean> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      chats.value = await fetchMyChats()
      return true
    } catch {
      // Сеть на старте могла ещё не подняться — короткая пауза и ещё раз.
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
  }
  return false
}

/** Открывает чат по push-уведомлению (данные приходят из service worker). */
const openChatFromPush = async (chatId: number, options: { pushNav?: boolean } = {}) => {
  if (!authStore.isAuthenticated) {
    // Пользователя откроет окно входа; пустой чат за ним показывать не нужно,
    // но чат запоминаем на время сеанса — после входа он откроется сам.
    pendingChatAfterLogin = chatId
    abortChatRestore(chatId)
    return
  }
  if (!chats.value.some((c) => c.id === chatId) && !(await loadChatsForRestore())) {
    abortChatRestore(chatId)
    return
  }
  // Чат мог быть удалён (или в адресе чужой id) — тогда просто остаёмся в
  // списке, а не открываем пустую нить с ошибкой. Адрес чистим.
  if (!chats.value.some((c) => c.id === chatId)) {
    abortChatRestore(chatId)
    return
  }
  await openChatThread(chatId, options)
  if (!isDesktop.value) drawerOpen.value = false
}

/**
 * Ставит курсор в поле ввода (кнопка «Ответить» в уведомлении).
 *
 * Печатать текст прямо в уведомлении веб-приложению нельзя (такого API нет),
 * поэтому «быстрый ответ» — это открытый чат с уже готовым к вводу полем:
 * человек сразу набирает текст, без лишних тапов.
 */
const focusComposer = async () => {
  await nextTick()
  composerRef.value?.focusInput()
}

/**
 * Тихо помечает чат прочитанным (кнопка push «Пометить как прочитанное»),
 * не открывая сам чат.
 */
const markChatReadQuietly = async (chatId: number) => {
  if (!authStore.isAuthenticated) return
  try {
    // GET истории сам помечает входящие чата прочитанными на сервере.
    await fetchMessages(chatId)
  } catch {
    return
  }
  const chat = chats.value.find((c) => c.id === chatId)
  if (chat) chat.unread_count = 0
}

/** Слушаем сообщения от service worker (клик по уведомлению). */
const handleWindowMessage = (event: MessageEvent) => {
  const data = event.data as {
    type?: string
    chat_id?: number
    /** Кнопка «Ответить» в уведомлении — открыть чат готовым к вводу. */
    reply?: boolean
    action?: string
    call_id?: string | null
    peer_id?: number | null
    /** Причина завершения звонка (для `call-cancelled`). */
    reason?: string | null
  } | null
  if (!data) return
  if (data.type === 'mark-chat-read' && typeof data.chat_id === 'number') {
    void markChatReadQuietly(data.chat_id)
    return
  }
  if (data.type === 'open-chat' && typeof data.chat_id === 'number') {
    void openChatFromPush(data.chat_id).then(() => {
      // Кнопка «Ответить»: после открытия чата сразу ставим курсор в поле ввода.
      if (data.reply === true) void focusComposer()
    })
    return
  }
  if (data.type === 'call-cancelled') {
    // Звонок завершился там, где мы его не видели (приняли на другом устройстве,
    // отклонили, зовущий снял вызов), а сигнальный канал у нас в этот момент не
    // работал. Гасим экран ожидания и «звонит», если это наш вызов — но НЕ
    // трогаем идущий разговор.
    const finishedId = String(data.call_id ?? '')
    if (callLaunch.value?.callId && callLaunch.value.callId === finishedId) {
      callLaunch.value = null
      stopCallLaunchScreen()
    }
    callStore.finishIfRinging(finishedId)
    return
  }
  if (data.type === 'call-push') {
    // Приложение было открыто, поэтому системного «будильника» не показывали:
    // звонок разбирает сам интерфейс (offer придёт по сигнальному каналу).
    syncCallRings()
    return
  }
  if (data.type === 'security-alert') {
    // Service worker получил тап по уведомлению о новом входе — разбираемся
    // в приложении (завершить чужие сессии или заморозить аккаунт).
    showSecurityAlert.value = true
    pushMobileNav()
    return
  }
  if (data.type === 'call-notification') {
    // Кнопки системного уведомления о звонке (service worker) и кнопки из push.
    const callId = String(data.call_id ?? '')
    const peerId = Number(data.peer_id)
    if (data.action === 'answer') {
      if (callStore.status === 'incoming') {
        void callStore.acceptCall()
      } else if (callId && Number.isFinite(peerId) && peerId > 0) {
        // Offer ещё не доставлен (канал отвалился, приложение было в фоне):
        // ждём его и отвечаем — иначе зовущий так и будет слышать гудки.
        beginCallLaunch(callId, peerId, 'answer')
      }
    } else if (data.action === 'decline') {
      if (callStore.status === 'incoming') {
        callStore.declineCall()
      } else if (callId && Number.isFinite(peerId) && peerId > 0) {
        callStore.declineCallTo(peerId, callId)
      }
    } else if (callId && Number.isFinite(peerId) && peerId > 0 && callStore.status === 'idle') {
      // Тап по телу уведомления (не по кнопке): показываем экран звонка.
      // Приложение могло стоять в фоне так долго, что сигнальный канал отвалился
      // и offer ждёт в парковке на сервере — без этого человек видел просто
      // список чатов, а звонок пропадал.
      beginCallLaunch(callId, peerId, 'focus')
    }
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('message', handleWindowMessage)
  window.removeEventListener('visibilitychange', handleCallVisibility)
  window.removeEventListener('visibilitychange', handleVisibilityForDrafts)
  window.removeEventListener('visibilitychange', handleVisibilityForPresence)
  window.removeEventListener('popstate', onAppPopState)
  window.removeEventListener('online', onNetworkOnline)
  unsubscribePeerKey?.()
  unsubscribePeerKey = null
  if (outboxTimer !== undefined) {
    window.clearInterval(outboxTimer)
    outboxTimer = undefined
  }
  disposeNativePush()
  disposeNativeShare()
  stopRealtime()
  realtimeStore.setHandler(null)
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
  if (inlineSearchTimer !== null) {
    window.clearTimeout(inlineSearchTimer)
    inlineSearchTimer = null
  }
  stopCallLaunchScreen()
})

watch(
  () => authStore.isAuthenticated,
  (isAuthenticated) => {
    showLoginModal.value = !isAuthenticated
    // Запуск из уведомления, пока сессия была недействительна: после входа
    // открываем запрошенный чат (память только этого сеанса).
    if (isAuthenticated && pendingChatAfterLogin !== null) {
      const chatId = pendingChatAfterLogin
      pendingChatAfterLogin = null
      void openChatFromPush(chatId, { pushNav: false })
    }
  },
  { immediate: true }
)

// ---------- Входящий звонок при свёрнутом приложении (системное уведомление) ----------
// Если звонок пришёл, а приложение свёрнуто/в фоне — показываем системный
// «будильник» с кнопкой «Ответить» ОДИН раз на звонок.
//
// Раньше уведомление пере-показывалось каждые 3,5 секунды (ради звука/вибрации,
// «как рингтон»). На Android это выглядело как бесконечный поток уведомлений:
// нажал «Ответить» — оно тут же возвращается; а если звонок к тому моменту уже
// завершился, возвращалось вечно. Уведомление и так держится на экране
// (`requireInteraction`), а когда звонок закончится, его закроет service worker.
const buildCallRing = () => {
  const peerName =
    callStore.peerName && !callStore.peerName.startsWith('@') ? callStore.peerName : ''
  return {
    title: peerName || 'Входящий звонок',
    body: callStore.kind === 'video' ? 'Видеозвонок' : 'Аудиозвонок',
    callId: callStore.callId ?? '',
    peerId: callStore.peerId ?? 0
  }
}

const ringIncomingCallWhenHidden = () => {
  if (!document.hidden) return
  if (callStore.status !== 'incoming' || callStore.peerId === null || !callStore.callId) return
  void showIncomingCallRing(buildCallRing())
}

/**
 * Единственный источник правды о том, что «звонит»: если звонок уже не входящий
 * (принят, идёт разговор, завершён) — ни рингтона, ни системного уведомления быть
 * не должно, где бы оно ни появилось: после ответа, повторного push или возврата
 * в приложение. Иначе получается «ещё один звонок» во время разговора.
 */
const syncCallRings = () => {
  if (callStore.status === 'incoming') return
  void closeCallRings()
}

/** Приложение свернули во время входящего звонка — будим и «звоним». */
const handleCallVisibility = () => {
  if (document.hidden) ringIncomingCallWhenHidden()
  else syncCallRings()
}

// Звонок ушёл из состояния «входящий» (принят/отменён/завершён) — убираем уведомление.
watch(() => callStore.status, syncCallRings)

// Сервер повторил предложение уже идущего вызова (или пришёл повторный push) —
// звонок заново не начинаем и висящее уведомление убираем.
watch(() => callStore.ignoredCallOffers, syncCallRings)

// Запуск из уведомления о звонке: offer доставлен (появился реальный звонок) —
// убираем промежуточный экран. Рингтон уже продолжает стор (здесь не глушим).
watch(
  () => callStore.status,
  (status) => {
    if (status !== 'idle' && callLaunchScreen.value !== 'none') {
      callLaunchScreen.value = 'none'
      if (callLaunchTimer !== undefined) {
        window.clearTimeout(callLaunchTimer)
        callLaunchTimer = undefined
      }
      callLaunch.value = null
    }
  }
)

// Кнопки push-уведомления о звонке: когда offer доставлен (звонок «входящий»),
// выполняем действие — «Ответить» принимает, «Отклонить» отклоняет.
watch(
  () => callStore.status,
  (status) => {
    if (status !== 'incoming') return
    if (autoDeclinePending) {
      autoDeclinePending = false
      callStore.declineCall()
    } else if (autoAnswerPending) {
      autoAnswerPending = false
      void callStore.acceptCall()
    }
  }
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
        avatarUrl: peer.avatar_thumb_url ?? peer.avatar_url ?? null
      })
    }
    // Если приложение свёрнуто — показываем системное уведомление о звонке.
    ringIncomingCallWhenHidden()
  },
  { immediate: true }
)

watch(
  selectedChatId,
  (newId, oldId) => {
    if (oldId != null && oldId !== newId) {
      sendTypingStop(oldId)
      saveDraftFor(oldId)
      // Ушли из чата — черновик отправляем сразу, не ждём задержки.
      flushDraftPushes()
    }
    exitMessageSelection()
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
    // Восстанавливаем черновик открытого чата (после сброса состояния выше).
    if (newId !== null) setComposerText(loadDraftFor(newId))
  },
  { immediate: true }
)
</script>

<style scoped>
/* ---------- Каркас (Quasar QLayout) ---------- */
.messenger-shell {
  /* Жёстко занимаем видимую область (в т. ч. при показе адресной строки и
     клавиатуры): position:fixed -> низ (поле ввода) всегда прижат к экрану,
     внешнего скролла документа нет.

     Высоту и смещение берём из композабла useVisualViewport: при открытой
     экранной клавиатуре визуальная область меньше окна, и без этого поле ввода
     уезжает под клавиатуру. */
  position: fixed;
  top: var(--ms-vv-top, 0);
  left: 0;
  right: 0;
  height: var(--ms-vv-h, 100%);
  /* Quasar (QLayout) вешает на этот же элемент ИНЛАЙНОВЫЙ
     `min-height: window.innerHeight` — он про клавиатуру не знает и перебивал
     высоту из --ms-vv-h: каркас оставался во весь экран, и поле ввода
     оказывалось под клавиатурой. Высота задана явно, минимум не нужен. */
  min-height: 0 !important;
  overflow: hidden;
  background: var(--ms-shell);
  font-family: var(--ms-font);
}

/* QPageContainer: в нём только чат, растягиваем на всю высоту. */
.messenger-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--ms-body);
}

/* Чат восстанавливается из адреса (перезагрузка страницы, повторное открытие
   PWA): вместо мигания списка чатов показываем лёгкую загрузку. */
.chat-restoring {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--q-primary);
  opacity: 0.85;
}

.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden; /* не даём контенту распирать панель и создавать скролл страницы */
  /* Точки фона — токеном: у него значения под светлую и тёмную тему
     (раньше был литерал rgba(), который в тёмной теме приходилось перебивать
     из appearance.css). */
  background-image: var(--ms-chat-dots);
  background-size: 22px 22px;
  background-color: var(--ms-chat-bg);
}

/* Drawer со списком чатов: тень и высота на весь экран. */
.ms-drawer :deep(.q-drawer__content) {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ---------- Quasar-модалки (профиль / оформление): карточки с рамкой ---------- */
.ms-modal {
  width: min(720px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  border-radius: var(--ms-radius-lg, 18px);
  border: 1px solid var(--ms-border, #e2e6ea);
  box-shadow: var(--ms-shadow-pop);
}

/* Профиль — часть темы: внутри UserProfile цвета берутся из токенов
   (`--ms-surface`, `--ms-text`), поэтому и карточка диалога следует теме. */
.ms-modal-profile {
  background: var(--ms-surface) !important;
  color: var(--ms-text) !important;
  border-color: var(--ms-border) !important;
}

.ms-modal-profile :deep(.q-separator) {
  background: var(--ms-border);
}

.ms-modal-head {
  padding: 8px 8px 8px 20px;
  min-height: 52px;
}

/* Внутренние отступы контента от краёв карточки */
.ms-modal-body {
  padding: 8px 22px 24px;
  max-height: 82vh;
  overflow: auto;
}

/* ---------- Модалка удаления чата ---------- */
.delchat-card {
  width: min(400px, calc(100vw - 32px));
  border-radius: var(--ms-radius-lg, 18px);
}

.delchat-head {
  padding: 8px 8px 8px 20px;
}

.delchat-body {
  padding: 6px 20px 10px;
}

.delchat-text {
  margin: 8px 0 10px;
  font-size: 14.5px;
}

.delchat-hint {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  margin: -2px 0 8px 30px;
}

.delchat-actions {
  padding: 8px 12px;
}

/* Примечание «защищено сквозным шифрованием» над строкой ввода (как в Telegram) */
.chat-e2ee-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 14px 4px;
  color: var(--ms-muted, #7b8a96);
  font-size: 12px;
  pointer-events: none;
  background: transparent;
}

.chat-e2ee-note .q-icon {
  color: var(--ms-accent, #2ea25e);
}

/* Панель выбора сообщений — вместо шапки чата (как в списке чатов) */
.chat-select-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--ms-surface, #ffffff);
  border-bottom: 1px solid var(--ms-border, #e2e6ea);
  box-shadow: var(--ms-shadow-sm);
  z-index: 2;
  flex: none;
}

.chat-select-info {
  flex: 1;
  min-width: 0;
}

.chat-select-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ms-text, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-select-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.chat-select-actions .icon-btn.danger {
  color: var(--ms-danger, #d64545);
}

.chat-select-actions .icon-btn.on {
  color: var(--ms-accent, #2ea25e);
}

/* Экран «Входящий звонок…» при запуске из push-уведомления о звонке */
.call-launch-wait {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ms-call-bg);
}

.clw-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}

.clw-ring {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  border: 4px solid var(--ms-call-ring);
  border-top-color: var(--ms-accent, #2ea25e);
  animation: clw-spin 1.1s linear infinite;
}

@keyframes clw-spin {
  to {
    transform: rotate(360deg);
  }
}

.clw-text {
  margin: 0;
  color: var(--ms-call-fg);
  font-size: 18px;
  font-weight: 600;
}

.clw-peer {
  margin: 0;
  color: var(--ms-call-fg);
  font-size: 22px;
  font-weight: 700;
  max-width: 78vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Кнопки экрана ожидания: зелёная «Ответить» слева, красная «Отклонить» справа
   (как в оверлее звонка — чтобы «принять» было на привычном месте). */
.clw-actions {
  display: flex;
  align-items: center;
  gap: 28px;
}

.clw-answer,
.clw-decline {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-call-fg);
  cursor: pointer;
  transition:
    transform 0.15s ease,
    filter 0.15s ease;
}

.clw-answer {
  background: var(--ms-accent, #2ea25e);
}

.clw-answer:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: scale(1.06);
}

.clw-answer:disabled {
  cursor: default;
  opacity: 0.7;
}

.clw-decline {
  background: var(--ms-call-danger);
}

.clw-decline:hover {
  background: var(--ms-call-danger);
  filter: brightness(0.9);
  transform: scale(1.06);
}

.call-launch-missed .clw-text {
  font-size: 16px;
  color: color-mix(in srgb, var(--ms-call-fg) 85%, transparent);
}
</style>
