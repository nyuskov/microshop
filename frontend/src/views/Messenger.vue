<template>
  <q-layout class="messenger-shell" view="hhh lpr fff">
    <!-- Озвучивание входящих сообщений скринридером (визуально скрыто) -->
    <p class="sr-only" role="status" aria-live="polite">{{ liveAnnouncement }}</p>
    <!-- Подсказка при перетаскивании файлов в окно: бросить можно в любом месте -->
    <FileDropOverlay :active="fileDropActive" :can-send="canDropFiles" />
    <!-- ======= QDrawer: Чаты / Контакты (десктоп и планшет — постоянная панель,
         телефон — выдвижной drawer поверх чата) ======= -->
    <!-- `persistent` на телефоне: без него Quasar сам скрывает drawer при
         ЛЮБОЙ смене `$route.fullPath` (use-model-toggle, hideOnRouteChange).
         Наш «программный шаг назад» (stepBackInApp) — это настоящий history.go,
         и vue-router после него «догоняет» адрес и видит смену маршрута: список
         закрывался в момент закрытия настроек, лайтбокса, карточки чата — человек
         оставался на переписке вместо списка. Навигацию на телефоне целиком
         ведёт приложение (utils/mobileNav.ts), поэтому гасим поведение Quasar.
         Свайп и закрытие по фону остаются — они управляются `no-swipe-*`. -->
    <q-drawer
      v-model="drawerOpen"
      side="left"
      :width="drawerWidth"
      :breakpoint="599"
      :show-if-above="true"
      :overlay="isPhone"
      :persistent="isPhone"
      :no-swipe-open="isPhone && selectedChatId !== null"
      :no-swipe-close="isPhone && selectedChatId === null"
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
        :archived-chat-ids="archivedChatIds"
        :chat-folders="chatFolders"
        :drafts="draftsByChatId"
        :self-name="selfName"
        :self-avatar-url="selfAvatarUrl"
        :is-admin="authStore.isAdmin"
        @open-message="openGlobalMessage"
        @toggle-pin="toggleChatPinned"
        @toggle-mute="toggleChatMuted"
        @bulk-mute="bulkSetMuted"
        @bulk-pin="bulkSetPinned"
        @bulk-archive="bulkSetArchived"
        @bulk-folders="openSelectedFolders"
        @create-folder="openFolderManager()"
        @manage-folder="manageFolder"
        @bulk-delete="chatOverlaysRef?.openBulkDelete($event)"
        @to-contacts="openContacts"
        @open-story="openStory"
        @to-chats="goToChats"
        @open-profile="goToProfile"
        @open-admin="goToAdmin"
        @select-chat="selectChat"
        @chat-opened="onChatOpened"
        @create-group="openCreateGroup"
        @create-channel="openCreateChannel"
        @open-channel="openChannelByUsername"
        @open-blocked="moderationOverlaysRef?.openBlocked()"
        @open-calls="callsOpen = true"
      />
    </q-drawer>

    <!-- ======= Правая область чата ======= -->
    <q-page-container class="messenger-page" :class="{ 'has-rail': railVisible }">
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
          <header v-if="messageSelection" class="chat-select-header">
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
                   наведением на сообщение (меню «⋯»). -->
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
            :show-call-button="isPrivateChat(selectedChat) || isGroupCallChat(selectedChat)"
            :show-back="isPhone"
            :peer-online="selectedChatPeerOnline"
            :peer-typing="isPeerTyping(selectedChat.id)"
            :pinned="selectedChatPinned"
            :archived="selectedChatArchived"
            :blocked="peerFullyBlocked"
            :calls-blocked="peerCallsBlocked"
            :e2ee="selectedChatE2ee"
            :has-pinned="pinnedRows.length > 0"
            :pinned-hidden="pinnedHidden"
            @back="goBackToList"
            @toggle-search="toggleInlineSearch"
            @open-info="openChatInfo"
            @start-call="startCall"
            @toggle-pin="toggleCurrentChatPin"
            @toggle-archive="toggleCurrentChatArchive"
            @open-chat-sound="chatSoundOpen = true"
            @open-chat-stats="chatStatsOpen = true"
            @open-chat-folders="openChatFolders"
            @toggle-calls-block="toggleSelectedPeerCalls"
            @report-chat="openReportForPeer"
            @block-chat="blockSelectedPeer"
            @toggle-pinned="togglePinnedBar"
          />

          <!-- Поиск по сообщениям -->
          <InlineSearchBar
            v-if="inlineSearchOpen"
            v-model:query="inlineQuery"
            :count="serverMatchCount"
            :current="inlineMatchIndex + 1"
            @prev="goToInlineMatch(-1)"
            @next="goToInlineMatch(1)"
            @close="toggleInlineSearch"
          />

          <!-- Закреплённые сообщения -->
          <PinnedBar
            v-if="pinnedRows.length && !pinnedHidden"
            v-model:open="pinnedOpen"
            :rows="pinnedRows"
            @scroll-to="scrollToPinnedMessage"
            @close-popups="closePopups"
            @close="pinnedHidden = true"
          />

          <!-- Сообщения -->
          <MessageThread
            ref="threadRef"
            :rows="messageRows"
            :loading="messagesLoading"
            :current-user-id="currentUserId"
            :highlighted-message-id="highlightedMessageId"
            :search-query="inlineSearchOpen ? inlineQuery.trim() : ''"
            :emoji-picker-for="emojiPickerFor"
            :quote-of="quoteFor"
            :selection-mode="messageSelection"
            :selected-message-ids="selectedMessageIds"
            :pending="threadPendingRows"
            :is-group-chat="isGroupChat(selectedChat)"
            :members="selectedChat.users"
            :unread-count="unreadAtOpen"
            :reminder-at="reminderAtOf"
            :channel-posts="selectedIsChannel"
            :post-meta="channelPostMeta"
            @unread-seen="clearUnreadDivider"
            @post-viewed="onPostViewed"
            @open-comments="openChannelComments"
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
            @open-reactions="openReactionUsers"
            @toggle-pin="togglePinMessage"
            @copy="copyMessage"
            @edit="startEditMessage"
            @forward="openForward"
            @save="saveMessageToSelf"
            @make-sticker="makeStickerFromMessage"
            @add-set="addStickerSet"
            @delete="deleteMessageOf"
            @report="openReportForMessage"
            @open-image="openImageFromMessage"
            @open-sticker="openStickerSetOf"
            @open-view-once="openViewOnce"
            @remind="openReminderDialog"
          />

          <!-- Примечание E2EE (как в Telegram) над строкой ввода -->
          <div v-if="selectedChatE2ee" class="chat-e2ee-note">
            <q-icon :name="icon('lock')" size="13px" aria-hidden="true" />
            <span>Сообщения защищены сквозным шифрованием</span>
          </div>

          <!-- Канал: подписчику писать нельзя — вместо композера предложка. -->
          <div v-if="selectedIsChannel && !canPostInChannel" class="channel-write-bar">
            <span class="channel-write-hint">
              <q-icon :name="icon('campaign')" size="17px" aria-hidden="true" />
              Публикуют владелец и админы канала
            </span>
            <q-btn
              unelevated
              no-caps
              color="primary"
              label="Предложить пост"
              @click="openChannelSuggest"
            />
          </div>

          <!-- Панель ввода (композер) -->
          <template v-else>
            <!-- Отложенные сообщения этого чата: видны и отменяются до отправки -->
            <ScheduledBar
              :rows="scheduledMessages"
              :decrypted="scheduledDecrypted"
              @cancel="cancelScheduled"
            />
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
              @send-scheduled="scheduleSend"
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
              @send-sticker="sendSticker"
              @send-sticker-image="sendStickerImage"
              @sticker-error="onStickerError"
            />
          </template>
        </template>
      </main>

      <!-- Правая панель (≥1280px): информация о чате/группе и общие медиа рядом с
           перепиской, а не модалкой поверх неё. Ключ по id чата — при смене чата
           компонент пересоздаётся и заново читает данные о нём. -->
      <aside v-if="railVisible && selectedChat" class="chat-rail" aria-label="Информация о чате">
        <ChatInfo
          v-if="!isGroupChat(selectedChat)"
          :key="selectedChat.id"
          panel
          :chat="selectedChat"
          :current-user-id="currentUserId"
          :subtitle="chatSubtitle(selectedChat)"
          :messages="messages"
          :e2ee-enabled="!!selectedChat.e2ee_enabled"
          @open-image="openChatInfoImage"
          @toggle-e2ee="onChatInfoToggleE2ee"
          @close="infoRailOpen = false"
        />
        <GroupChatInfo
          v-else
          :key="selectedChat.id"
          panel
          :chat="selectedChat"
          :current-user-id="currentUserId"
          :contacts="contacts"
          :online-user-ids="onlineUserIds"
          :e2ee-enabled="!!selectedChat.e2ee_enabled"
          @updated="onGroupInfoUpdated"
          @left="onGroupLeft"
          @members-changed="onGroupMembersChanged"
          @toggle-e2ee="onChatInfoToggleE2ee"
          @close="infoRailOpen = false"
        />
      </aside>
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

  <!-- Кто поставил реакцию (удержание или правый клик по чипу) -->
  <ReactionUsersDialog
    v-if="reactionUsersFor"
    :reactions="reactionUsersFor.message.reactions"
    :members="selectedChat?.users ?? []"
    :my-user-id="currentUserId"
    :initial-emoji="reactionUsersFor.emoji"
    :anchor="reactionUsersFor.anchor"
    @close="reactionUsersFor = null"
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

  <!-- Profile Modal (Quasar). На телефоне — во весь экран (`maximized`):
       карточка оставляла по краям полоски чата и два вложенных скролла. -->
  <q-dialog v-model="showProfileModal" :maximized="!isDesktop" @hide="onProfileHidden">
    <q-card class="ms-modal ms-modal-profile" :class="{ 'ms-modal-full': !isDesktop }">
      <q-card-section class="row no-wrap items-center ms-modal-head">
        <!-- Заголовок окна — название текущего экрана: обычные настройки или
             админский раздел (в него входит «шестерёнка» из списка чатов). -->
        <div class="text-subtitle1 text-weight-medium ellipsis">{{ profileTitle }}</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
      </q-card-section>
      <q-separator />
      <q-card-section class="ms-modal-body">
        <Suspense>
          <template #default>
            <UserProfile
              ref="profileRef"
              :start-section="profileStartSection"
              @close-modal="showProfileModal = false"
              @open-moderation="openModerationFromAdmin"
            />
          </template>
          <template #fallback>
            <div class="q-pa-md">Загрузка профиля...</div>
          </template>
        </Suspense>
      </q-card-section>
    </q-card>
  </q-dialog>

  <!-- История: полноэкранный просмотр -->
  <StoryViewer
    v-if="openStoryId !== null"
    :groups="storiesStore.groups"
    :start-story-id="openStoryId"
    @close="openStoryId = null"
    @reply="replyToStory"
  />

  <!-- Звук уведомлений выбранного чата (настройка устройства) -->
  <ChatSoundDialog
    v-if="chatSoundOpen && selectedChat"
    :chat-id="selectedChat.id"
    :chat-title="chatTitle(selectedChat, currentUserId)"
    @close="chatSoundOpen = false"
  />

  <!-- Напоминание о сообщении: время выбирается пресетами, живёт на сервере -->
  <ReminderDialog
    v-if="reminderTarget"
    :message-id="reminderTarget.id"
    :preview="reminderPreview"
    :chat-title="selectedChat ? chatTitle(selectedChat, currentUserId) : ''"
    :reminder="reminderFor(reminderTarget.id)"
    :busy="reminderBusy"
    @save="saveReminder"
    @remove="removeReminder"
    @close="closeReminderDialog"
  />

  <!-- Удаление сообщения: «у себя» или галкой «Удалить для <имя>» (один диалог
       и для одного сообщения, и для выделенных) -->
  <DeleteMessageDialog
    v-if="showDeleteMessageDialog"
    :count="deleteMessageCount"
    :can-delete-for-all="deleteMessageCanForAll"
    :for-all-label="deleteForAllLabel"
    :for-all-hint="deleteForAllHint"
    @confirm="finishDeleteScope"
    @close="finishDeleteScope(null)"
  />

  <!-- Набор стикера: тап по стикеру показывает весь набор и даёт его добавить -->
  <StickerSetDialog
    v-if="stickerSet"
    :set="stickerSet"
    @send="sendStickerImage"
    @error="sendError = $event"
    @close="stickerSet = null"
  />

  <!-- Статистика чата: сообщения по дням, участники, вложения -->
  <ChatStatsDialog
    v-if="chatStatsOpen && selectedChat"
    :chat-id="selectedChat.id"
    @close="chatStatsOpen = false"
  />

  <!-- Папки чатов: свои списки с ручным порядком (настройка устройства) -->
  <ChatFoldersDialog
    v-if="foldersOpen"
    :folders="chatFolders"
    :chats="chats"
    :current-user-id="currentUserId"
    @close="foldersOpen = false"
    @create="createChatFolder"
    @rename="renameChatFolder"
    @remove="deleteChatFolder"
    @toggle-chat="toggleFolderChat"
    @move-chat="moveFolderChatChat"
  />

  <!-- Отметить папки для чата/чатов (меню чата, панель выделения, поиск) -->
  <ChatFolderPicker
    v-if="folderPickerChatIds"
    :folders="chatFolders"
    :chat-ids="folderPickerChatIds"
    :target="folderPickerTarget"
    @close="folderPickerChatIds = null"
    @create="createFolderWithChats"
    @toggle="toggleFolderForPicker"
  />

  <!-- История звонков: записи всех личных чатов, фильтр «Пропущенные»,
       «Перезвонить» тем же типом звонка. -->
  <CallHistoryDialog
    v-if="callsOpen"
    @close="callsOpen = false"
    @open-chat="openChatFromCalls"
    @call-back="callBackFromHistory"
  />

  <!-- Информация о чате/группе, создание группы и удаление чата — состояние
       этих диалогов живёт в отдельном компоненте (v-model у трёх «назад»-флагов). -->
  <MessengerChatOverlays
    ref="chatOverlaysRef"
    v-model:chat-info="showChatInfoModal"
    v-model:group-info="showGroupInfoModal"
    v-model:create-group="showCreateGroupModal"
    :chat="selectedChat"
    :chats="chats"
    :contacts="contacts"
    :messages="messages"
    :online-user-ids="onlineUserIds"
    :current-user-id="currentUserId"
    :subtitle="selectedChat ? chatSubtitle(selectedChat) : ''"
    @open-image="openChatInfoImage"
    @e2ee-toggle="onChatInfoToggleE2ee"
    @group-updated="onGroupInfoUpdated"
    @group-left="onGroupLeft"
    @members-changed="onGroupMembersChanged"
    @group-created="onGroupCreated"
    @delete-confirmed="onDeleteChatConfirmed"
  />

  <!-- Каналы: создание, подписка по ссылке, комментарии под постом, настройки
       и «предложить пост» — состояние диалогов живёт в отдельном компоненте. -->
  <MessengerChannelOverlays
    ref="channelOverlaysRef"
    :chat="selectedChat"
    :chat-id="selectedChatId"
    :chats="chats"
    @created="onChannelCreated"
    @joined="onChannelJoined"
    @updated="onChannelUpdated"
    @left="onChannelLeft"
    @comments-count="onChannelCommentsCount"
  />

  <!-- Вход, тревога «новый вход» и смена ключа собеседника — состояние этих
       диалогов живёт в MessengerAccountOverlays.vue. -->
  <MessengerAccountOverlays ref="accountOverlaysRef" :peer-name-for="peerKeyNameFor" />

  <!-- Модерация: жалоба, список блокировок и разбор жалоб — состояние диалогов
       живёт в MessengerModerationOverlays.vue. -->
  <MessengerModerationOverlays
    ref="moderationOverlaysRef"
    :is-admin="authStore.isAdmin"
    @blocked-changed="onBlockedUsersChanged"
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
  <!-- Одноразовое вложение: своё окно (листать и скачивать нельзя) -->
  <ViewOnceViewer
    v-if="viewOnceView"
    :url="viewOnceView.url"
    :kind="viewOnceView.kind"
    :name="viewOnceView.name"
    @close="closeViewOnce"
  />

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
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { getErrorMessage, isChatGoneError, isNetworkError } from '@/services/errors'
import { watchServiceWorkerUpdate } from '@/services/swUpdate'
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
  bootstrapE2ee,
  chatAesKeyFor,
  chatDecryptKeysFor,
  clearChatKeyCache,
  decryptTextWithKeys,
  distributeChatKey,
  distributeGroupKey,
  e2eeReadyForChat,
  encryptText,
  isE2eeAvailable,
  isEncryptedPayload,
  onPeerKeyChanged,
  refreshChatKeyWrappers,
  resetE2eeSession
} from '@/services/e2ee'
import { encryptFileForChat, parseFileMeta } from '@/services/e2eeFiles'
import {
  decryptedMediaFor,
  preloadDecryptedMedia,
  releaseDecryptedMedia,
  releaseDecryptedMediaExcept
} from '@/composables/useDecryptedMedia'
import { useMessageReminders } from '@/composables/useMessageReminders'
import { useMessageSelection } from '@/composables/useMessageSelection'
import { useOutbox } from '@/composables/useOutbox'
import { usePeerBlocking } from '@/composables/usePeerBlocking'
import { useScheduledSend } from '@/composables/useScheduledSend'
import { useStandardSetImport } from '@/composables/useStandardSetImport'
import { useThreadPagination, MESSAGES_PAGE_SIZE } from '@/composables/useThreadPagination'
import {
  packIdOfFileName,
  presetSetOfFileName,
  presetStickerFileName,
  packStickerFileName
} from '@/utils/presetStickers'
import { resolveStickerSet, type StickerSetRef } from '@/utils/stickerSet'
import type {
  Chat,
  ChatUser,
  ChannelCard,
  EncryptedFileMeta,
  GroupInvitePreview,
  Message
} from '@/types'
import { avatarUrlOf, chatPeer, chatTitle, displayName, isGroupChat } from '@/utils/user'
import { stopAllRecognitions } from '@/utils/voiceRecognition'
import { usernameFromProfilePath } from '@/utils/profileLink'
import { channelUsernameFromPath } from '@/utils/channelLink'
import { inviteTokenFromPath } from '@/utils/groupInvite'
import { lastSeenLabel } from '@/utils/format'
import { buildMessageRows, type MessageRow as ThreadRow } from '@/utils/thread'
import { effectiveFile, messageSnippet, optimizeImageFile } from '@/utils/media'
import type { CallHistoryItem } from '@/utils/callHistory'
import { fetchChannel, fetchPostsMeta, markPostViewed } from '@/services/channelService'
import { type Section } from '@/utils/mobileNav'
import { mediaUrl } from '@/config'
import { stickerFromMessage } from '@/services/stickers'
import { useStickersStore } from '@/stores/stickers'
import { chatIdFromUrl, isReplyLaunch, readStoredSection, storeSection } from '@/utils/chatUrl'
import { haptic } from '@/utils/haptics'
import { usePeerActivity } from '@/composables/usePeerActivity'
import { useRealtimeSync } from '@/composables/useRealtimeSync'
import { useRecordButton } from '@/composables/useRecordButton'
import { useCallSession } from '@/composables/useCallSession'
import { useChatNavigation } from '@/composables/useChatNavigation'
import { useChatFolders } from '@/composables/useChatFolders'
import { useChatUnreadState } from '@/composables/useChatUnreadState'
import { useDrafts } from '@/composables/useDrafts'
import { useForward } from '@/composables/useForward'
import { useMediaRecording } from '@/composables/useMediaRecording'
import { useLightbox } from '@/composables/useLightbox'
import { useNativeShare } from '@/composables/useNativeShare'
import { useFileDrop } from '@/composables/useFileDrop'
import {
  ONLINE_RESTORED_EVENT,
  setConnectionSyncing,
  useOnlineStatus
} from '@/composables/useOnlineStatus'
import ChatSidebar from '@/components/messenger/ChatSidebar.vue'
import ChatHeader from '@/components/messenger/ChatHeader.vue'
import ChatPlaceholder from '@/components/messenger/ChatPlaceholder.vue'
import FileDropOverlay from '@/components/messenger/FileDropOverlay.vue'
import InlineSearchBar from '@/components/messenger/InlineSearchBar.vue'
import PinnedBar from '@/components/messenger/PinnedBar.vue'
import MessageThread from '@/components/messenger/MessageThread.vue'
import type { PendingRow } from '@/components/messenger/MessageThread.vue'
import MessageComposer from '@/components/messenger/MessageComposer.vue'
import ScheduledBar from '@/components/messenger/ScheduledBar.vue'
import MessengerChannelOverlays from '@/views/MessengerChannelOverlays.vue'
import MessengerChatOverlays from '@/views/MessengerChatOverlays.vue'
import MessengerModerationOverlays from '@/views/MessengerModerationOverlays.vue'
import MessengerAccountOverlays from '@/views/MessengerAccountOverlays.vue'

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
const VideoRecorderModal = defineAsyncComponent(
  () => import('@/components/media/VideoRecorderModal.vue')
)
const ImageLightbox = defineAsyncComponent(() => import('@/components/media/ImageLightbox.vue'))
/** Просмотр одноразового вложения: своё окно без листания и «Скачать». */
const ViewOnceViewer = defineAsyncComponent(() => import('@/components/media/ViewOnceViewer.vue'))
// Карточка приглашения нужна только по ссылке — отдельный чанк.
const GroupInviteDialog = defineAsyncComponent(
  () => import('@/components/messenger/GroupInviteDialog.vue')
)
// Диалоги модерации (требования RuStore) — в MessengerModerationOverlays.vue.
// Просмотрщик историй — открывается по клику на историю.
const StoryViewer = defineAsyncComponent(() => import('@/components/stories/StoryViewer.vue'))
const ChatSoundDialog = defineAsyncComponent(
  () => import('@/components/messenger/ChatSoundDialog.vue')
)
const ReminderDialog = defineAsyncComponent(
  () => import('@/components/messenger/ReminderDialog.vue')
)
const DeleteMessageDialog = defineAsyncComponent(
  () => import('@/components/messenger/DeleteMessageDialog.vue')
)
const StickerSetDialog = defineAsyncComponent(
  () => import('@/components/messenger/StickerSetDialog.vue')
)
const ChatStatsDialog = defineAsyncComponent(
  () => import('@/components/messenger/ChatStatsDialog.vue')
)
// Папки чатов: управление составом и выбор папок для чата — отдельные чанки
// (нужны только когда человек сам открыл папки).
const ChatFoldersDialog = defineAsyncComponent(
  () => import('@/components/messenger/ChatFoldersDialog.vue')
)
const ChatFolderPicker = defineAsyncComponent(
  () => import('@/components/messenger/ChatFolderPicker.vue')
)
// История звонков — отдельный экран, чанк подгружается по открытию меню «Звонки».
const CallHistoryDialog = defineAsyncComponent(
  () => import('@/components/messenger/CallHistoryDialog.vue')
)
// Информация о чате/группе: на широком экране — правая панель (см. railVisible),
// на остальных — модалка внутри MessengerChatOverlays. Компоненты те же, поэтому
// содержимое не расходится между панелью и диалогом.
const ChatInfo = defineAsyncComponent(() => import('@/components/messenger/ChatInfo.vue'))
const GroupChatInfo = defineAsyncComponent(() => import('@/components/messenger/GroupChatInfo.vue'))
const ReactionUsersDialog = defineAsyncComponent(
  () => import('@/components/messenger/ReactionUsersDialog.vue')
)
import { useCallStore } from '@/stores/call'
import { useContactsStore } from '@/stores/contacts'
import { useRealtimeStore } from '@/stores/realtime'
import { useStoriesStore } from '@/stores/stories'
import { isQuietHoursNow } from '@/utils/quietHours'
import { chatSoundKey, playIncomingMessageSound } from '@/utils/sounds'
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushPermission,
  closeCallRings
} from '@/services/pwa'
import {
  disableNativePush,
  enableNativePush,
  initNativePush,
  isNativeApp
} from '@/services/nativePush'

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
  /** Открыть админский экран (служительные разделы: приглашения, жалобы). */
  openAdmin: () => void
}
const profileRef = ref<ProfileHandle | null>(null)
const showChatInfoModal = ref(false)
const showGroupInfoModal = ref(false)
const showCreateGroupModal = ref(false)
/** Открыт диалог «Звук уведомлений» выбранного чата. */
const chatSoundOpen = ref(false)
/** Открыт диалог «Статистика чата». */
const chatStatsOpen = ref(false)
// Каналы: создание, подписка по ссылке, комментарии под постом и настройки —
// состояние этих диалогов живёт в отдельном компоненте (см. ниже).
/** Карточка открытого канала (шапка: число подписчиков, роль, настройки). */
const channelCard = ref<ChannelCard | null>(null)
/** Счётчики постов открытого канала по id сообщения. */
const channelPostMeta = ref<Record<number, { views: number; comments: number }>>({})
/** Диалоги каналов: методы open* / closeAll. */
const channelOverlaysRef = ref<InstanceType<typeof MessengerChannelOverlays> | null>(null)
/** Оверлеи «чат и группа»: методы openDelete / openBulkDelete. */
const chatOverlaysRef = ref<InstanceType<typeof MessengerChatOverlays> | null>(null)
/** Оверлеи входа и безопасности: методы setLoginVisible / openSecurityAlert / openPeerKeyChanged. */
const accountOverlaysRef = ref<InstanceType<typeof MessengerAccountOverlays> | null>(null)
/** Диалоги модерации: методы openReport / openBlocked / openReports. */
const moderationOverlaysRef = ref<InstanceType<typeof MessengerModerationOverlays> | null>(null)

// ---------- Quasar: адаптивный layout (drawer на телефоне) ----------
const $q = useQuasar()
/**
 * Раскладка по ширине окна (пороги Quasar):
 *   < 600px   — телефон: список и нить живут на одном экране, drawer поверх чата;
 *   600–1023  — планшет: две панели рядом (список 320px + нить);
 *   ≥ 1024px  — десктоп: две панели, список шире (380px).
 * `isDesktop` нужен там, где дело именно в большом экране (размер модалок),
 * `twoPane` — «список и нить видны одновременно» (история приложения, возврат
 * к списку этим и определяется).
 */
const isDesktop = computed(() => $q.screen.gt.sm)
/** Телефон: список и нить — один экран, навигация по истории приложения. */
const isPhone = computed(() => $q.screen.lt.sm)
/** Две панели рядом (планшет и десктоп). */
const twoPane = computed(() => !isPhone.value)

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

/** На телефоне список и нить — один экран: если в адресе чат, показываем нить. */
const initialDrawerOpen = initialChatId === null || twoPane.value

/** Открыт ли drawer со списком чатов (значим на телефоне). */
const drawerOpen = ref(initialDrawerOpen)
/**
 * Ширина панели чатов: 380px на десктопе, 320px на планшете (на 600–1023 px
 * 380px съедала бы половину экрана), на телефоне — почти во весь экран.
 */
const drawerWidth = computed(() => {
  if (isDesktop.value) return 380
  if (isPhone.value) return Math.min($q.screen.width, 460)
  return 320
})

// Адрес (?chat=), история приложения и системная «назад» — в composables/useChatNavigation.ts.
// Вызов ниже (там, где объявлены все зависимости: раздел, выделение, слои).

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
const contactsLoading = computed(() => contactsStore.loading)
const selectedChatId = ref<number | null>(initialChatId)

const newMessage = ref('')
const sending = ref(false)
const sendingFile = ref(false)
const sendError = ref('')
/** Паки стикеров: панель в композере и «В стикеры» из меню картинки. */
const stickerStore = useStickersStore()
const replyTarget = ref<Message | null>(null)
const inlineSearchOpen = ref(false)
const inlineQuery = ref('')
const emojiPickerFor = ref<number | null>(null)
// Единое меню доп.контента поля ввода: 'emoji' | 'gif' | закрыто.
const extrasTab = ref<'emoji' | 'stickers' | 'gif'>('emoji')
const extrasPanel = ref<'none' | 'emoji' | 'stickers' | 'gif'>('none')
const pinnedOpen = ref(false)
/** Шторка закреплённых скрыта в этом чате (крестик); при переходе в чат — снова видна. */
const pinnedHidden = ref(false)
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

// ---------- Правая панель: информация о чате и его медиа ----------
/**
 * Широкий экран (≥1280px): информации о чате хватает места рядом с ним, поэтому
 * она живёт в правой колонке, а не модалкой поверх переписки. На более узких
 * экранах (и для каналов, у которых своя навигация по разделам внутри диалога)
 * остаётся прежняя модалка.
 */
const isWide = computed(() => $q.screen.width >= 1280)
/** Открыта ли правая панель (на широком экране). */
const infoRailOpen = ref(false)
const railVisible = computed(
  () => infoRailOpen.value && isWide.value && !!selectedChat.value && !selectedChat.value.is_channel
)

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

// ---------- Архив чатов (личная настройка вида, хранится локально) ----------
// Зачем: замьюченные/шумные чаты не должны занимать место в «Все», но и терять
// их не хочется. Архив — отдельный чип в списке (как в Telegram): чат остаётся
// с историей и уведомлениями, просто живёт в стороне. Так же, как пины, архив
// хранится в localStorage по id пользователя — сервер об этом не знает.
const ARCHIVED_CHATS_KEY = 'pismo_archived_chats'

const readArchivedChats = (): number[] => {
  const uid = currentUserId.value
  if (uid === null) return []
  try {
    const raw = window.localStorage.getItem(ARCHIVED_CHATS_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, number[]>) : {}
    const list = all[String(uid)]
    return Array.isArray(list) ? list.filter((id) => typeof id === 'number') : []
  } catch {
    return []
  }
}

const writeArchivedChats = () => {
  const uid = currentUserId.value
  if (uid === null) return
  try {
    const raw = window.localStorage.getItem(ARCHIVED_CHATS_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, number[]>) : {}
    all[String(uid)] = archivedChatIds.value
    window.localStorage.setItem(ARCHIVED_CHATS_KEY, JSON.stringify(all))
  } catch {
    // localStorage недоступен — архив просто не сохранится.
  }
}

const archivedChatIds = ref<number[]>([])

watch(
  currentUserId,
  () => {
    archivedChatIds.value = readArchivedChats()
  },
  { immediate: true }
)

const isChatArchived = (chatId: number): boolean => archivedChatIds.value.includes(chatId)

const toggleChatArchived = (chatId: number) => {
  const next = new Set(archivedChatIds.value)
  if (next.has(chatId)) {
    next.delete(chatId)
  } else {
    next.add(chatId)
  }
  archivedChatIds.value = Array.from(next)
  writeArchivedChats()
}

/** Архивировать/вернуть сразу несколько чатов (режим выделения). */
const bulkSetArchived = (chatIds: number[], archived: boolean) => {
  const next = new Set(archivedChatIds.value)
  chatIds.forEach((id) => {
    if (archived) next.add(id)
    else next.delete(id)
  })
  archivedChatIds.value = Array.from(next)
  writeArchivedChats()
}

/** Лежит ли открытый чат в архиве (подпись пункта меню в шапке). */
const selectedChatArchived = computed<boolean>(
  () => selectedChat.value !== null && isChatArchived(selectedChat.value.id)
)

/** В архив/из архива открытый чат. */
const toggleCurrentChatArchive = () => {
  const chat = selectedChat.value
  if (chat !== null) toggleChatArchived(chat.id)
}

// ---------- Папки чатов (личная настройка вида, хранится локально) ----------
// Зачем: список чатов растёт, и базовых фильтров уже мало. Папка — свой список
// конкретных чатов с ручным порядком (как в Telegram). Хранится на устройстве
// (`pismo_chat_folders`), как архив и пины: сервер о папках не знает.
const {
  folders: chatFolders,
  create: createFolderRaw,
  rename: renameFolderRaw,
  remove: removeFolderRaw,
  toggleChat: toggleFolderChatRaw,
  setChats: setFolderChatsRaw,
  moveChat: moveFolderChatRaw,
  prune: pruneFolders
} = useChatFolders(currentUserId)

const foldersOpen = ref(false) /** Чаты, для которых открыт выбор папок (null — диалог закрыт). */
const folderPickerChatIds = ref<number[] | null>(null)

/** Подпись в диалоге выбора: название чата или «3 чата». */
const folderPickerTarget = computed<string>(() => {
  const ids = folderPickerChatIds.value ?? []
  if (ids.length === 1) {
    const id = ids[0] as number
    const chat = chats.value.find((item) => item.id === id)
    return chat ? chatTitle(chat, currentUserId.value) : 'Чат'
  }
  return `${ids.length} ${ids.length === 1 ? 'чат' : ids.length < 5 ? 'чата' : 'чатов'}`
})

/** Чаты, которых больше нет, из папок убираем (список чатов уже загружен). */
watch(
  chats,
  (list) => {
    if (list.length) pruneFolders(list.map((chat) => chat.id))
  },
  { immediate: true }
)

/** Диалог управления папками: из чипа «+» (создание) или по долгому тапу. */
const openFolderManager = () => {
  foldersOpen.value = true
}

const manageFolder = (_id: string) => {
  // Управление одной папкой живёт в том же диалоге: он открывается на списке,
  // а нужная папка раскрывается тапом. Долгий тап по чипу — короткий путь сюда.
  foldersOpen.value = true
}

// Успешные действия подтверждаем молча: папка появляется в списке чипов, и
// всплывающая плашка поверх интерфейса тут только мешает.
const createChatFolder = (name: string) => {
  createFolderRaw(name)
}

const renameChatFolder = (id: string, name: string) => renameFolderRaw(id, name)

const deleteChatFolder = (id: string) => {
  removeFolderRaw(id)
  // Активный фильтр мог смотреть в удалённую папку — вернёмся к «Все»
  // (сайдбар сделает это сам, когда список чипов изменится).
  foldersOpen.value = false
}

const toggleFolderChat = (id: string, chatId: number) => toggleFolderChatRaw(id, chatId)

const moveFolderChatChat = (id: string, chatId: number, delta: -1 | 1) =>
  moveFolderChatRaw(id, chatId, delta)

/** Меню чата → «В папку…»: выбор папок для открытого чата. */
const openChatFolders = () => {
  const chat = selectedChat.value
  if (chat !== null) folderPickerChatIds.value = [chat.id]
}

/** Панель выделения → «В папку»: выбрать папки сразу для нескольких чатов. */
const openSelectedFolders = (ids: number[]) => {
  if (ids.length) folderPickerChatIds.value = [...ids]
}

/** Клик по папке в диалоге выбора: сразу добавляем/убираем все выбранные чаты. */
const toggleFolderForPicker = (id: string, inside: boolean) => {
  const ids = folderPickerChatIds.value
  if (!ids?.length) return
  setFolderChatsRaw(id, ids, inside)
}

/** Создать папку прямо из диалога выбора — сразу с этими чатами. */
const createFolderWithChats = (name: string) => {
  const ids = folderPickerChatIds.value ?? []
  const id = createFolderRaw(name, ids[0])
  if (!id) return
  if (ids.length > 1) setFolderChatsRaw(id, ids, true)
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
    // В личном чате — тоже: симметричный ключ раздаётся на устройства обоих
    // участников, иначе второе устройство не прочитает новые сообщения (A5).
    if (enabled && isPrivateChat(chat)) await distributePersonalChatKey(chat)
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

/**
 * Раздаёт ключ ЛИЧНОГО чата на устройства обоих участников.
 *
 * `create` — выпустить ключ: в личном чате его создаёт тот, кто включает
 * шифрование, а флаг `e2ee_enabled` меняется один раз на чат, поэтому две
 * стороны не выпускают два разных ключа.
 */
const distributePersonalChatKey = async (chat: Chat, create = true): Promise<void> => {
  const uid = currentUserId.value
  if (uid === null || !e2eeMyKeyReady.value || !isPrivateChat(chat)) return
  try {
    const ids = chat.users.map((user) => user.id)
    const { raw, missing } = await distributeChatKey(uid, chat.id, ids, { create })
    if (missing.length > 0) {
      console.warn(
        'Ключ чата не удалось отдать всем устройствам (нет ключа устройства):',
        missing.join(', ')
      )
    }
    if (!raw) console.warn('Ключ чата не выпущен: обёртки для устройств не сохранились')
  } catch (error) {
    console.error('Не удалось раздать ключ чата:', getErrorMessage(error))
  }
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
 * `useLightbox`, когда кадр реально показывают. Иначе при каждом рендере чата
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

// Кадры, текущий индекс и листание — в composables/useLightbox.ts. Открытие
// помечаем в истории приложения: лайтбокс закрывает системная «назад».

// ---------- Одноразовые медиа («посмотреть один раз») ----------
/** Открытое одноразовое вложение (null — окно закрыто). */
const viewOnceView = ref<{
  url: string
  kind: 'image' | 'video' | 'file'
  name: string
} | null>(null)
/** Открытые в этой сессии: плашка сразу показывает «Просмотрено». */
const viewOnceOpened = reactive(new Set<number>())

const viewOnceKindOf = (message: Message): 'image' | 'video' | 'file' => {
  const mime = message.file?.mime ?? ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}

/**
 * Скачивает одноразовое вложение и отдаёт ссылку на содержимое.
 *
 * Для E2EE это расшифрованная копия (blob:), для обычного чата — тоже blob, а не
 * адрес сервера: адрес можно перезапросить из истории браузера, а blob живёт
 * только в этой вкладке и освобождается при закрытии.
 */
const fetchViewOnceUrl = async (message: Message): Promise<string | null> => {
  const file = message.file
  if (!file) return null
  if (message.e2ee_file) {
    // Расшифровка идёт тем же путём, что у обычных медиа: ждём готовности.
    for (let i = 0; i < 100; i += 1) {
      const ready = decryptedMediaFor(message)?.url
      if (ready) return ready
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100))
    }
    throw new Error('Расшифровка не завершилась')
  }
  const response = await fetch(mediaUrl(file.url))
  if (!response.ok) throw new Error(`Сервер ответил ${response.status}`)
  return URL.createObjectURL(await response.blob())
}

const openViewOnce = async (message: Message) => {
  if (message.view_once_opened || viewOnceOpened.has(message.id)) return
  sendError.value = ''
  try {
    const url = await fetchViewOnceUrl(message)
    if (!url) return
    pushMobileNav()
    viewOnceOpened.add(message.id)
    // Сервер уже отдал файл — в ленте показываем «Просмотрено».
    message.view_once_opened = true
    viewOnceView.value = {
      url,
      kind: viewOnceKindOf(message),
      name: message.file?.name ?? 'Медиа'
    }
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось открыть одноразовое медиа')
  }
}

const closeViewOnce = () => {
  const current = viewOnceView.value
  // Свою копию сразу отпускаем: одноразовое медиа не должно остаться в памяти.
  if (current?.url.startsWith('blob:')) URL.revokeObjectURL(current.url)
  viewOnceView.value = null
}

const {
  items: lightboxItems,
  index: lightboxIndex,
  open: openImageFromMessage,
  close: closeLightbox,
  step: lightboxStep
} = useLightbox({
  messages: () => messages.value,
  urlOf: lightboxUrlOf,
  needsPrepare: (message) => !!message.e2ee_file,
  prepare: (message) => {
    decryptedMediaFor(message)
  },
  onOpen: () => pushMobileNav()
})

// ---------- Информация о чате / группе ----------
const openChatInfo = () => {
  const chat = selectedChat.value
  // Широкий экран: правая панель (та же информация, но рядом с чатом). Повторный
  // клик закрывает её — панель работает как переключатель: и клик по названию
  // чата, и пункт «Информация о чате» в меню «⋯» ведут сюда.
  // Каналы оставляем в диалоге: у них внутри своя навигация по разделам.
  if (chat && !chat.is_channel && isWide.value) {
    infoRailOpen.value = !infoRailOpen.value
    return
  }
  pushMobileNav()
  if (chat?.is_channel) {
    channelOverlaysRef.value?.openInfo()
    void refreshChannelCard()
  } else if (chat && isGroupChat(chat)) {
    showGroupInfoModal.value = true
  } else {
    showChatInfoModal.value = true
  }
}

/** Открыть диалог «Новый канал» из меню «⋯» в списке чатов. */
const openCreateChannel = () => {
  pushMobileNav()
  channelOverlaysRef.value?.openCreate()
}

/**
 * Открыть карточку канала по его адресу — результат поиска на вкладке «Каналы».
 *
 * Тот же экран, что по ссылке `/c/<адрес>`: там видно описание и кнопка
 * «Подписаться»/«Открыть канал».
 */
const openChannelByUsername = (username: string) => {
  if (!username) return
  pushMobileNav()
  channelOverlaysRef.value?.openJoin(username)
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
 * Ключ чата для ШИФРОВАНИЯ: у личного чата — симметричный ключ из обёрток
 * (A5: его читают все устройства обоих участников), у группы — её ключ.
 * null = чат не зашифрован/ключей нет.
 */
const chatKeyOf = async (chat: Chat | null): Promise<CryptoKey | null> => {
  const uid = currentUserId.value
  if (uid === null || !chat || !chat.e2ee_enabled || !e2eeMyKeyReady.value) return null
  return chatAesKeyFor(uid, chat)
}

/**
 * Ключи для РАСШИФРОВКИ: их может быть два — симметричный из обёрток и прежний
 * из общего секрета двух «текущих» устройств (сообщения, ушедшие с устройства,
 * которое обёртки ещё не получило).
 */
const chatDecryptKeysOf = async (chat: Chat | null): Promise<CryptoKey[]> => {
  const uid = currentUserId.value
  if (uid === null || !chat || !chat.e2ee_enabled || !e2eeMyKeyReady.value) return []
  return chatDecryptKeysFor(uid, chat)
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
  // В личном зашифрованном чате обновляем обёртки: так ключ доходит до нового
  // устройства собеседника (само оно раздать не может — у него ещё нет ключа).
  if (chat.e2ee_enabled && isPrivateChat(chat) && e2eeMyKeyReady.value) {
    await refreshChatKeyWrappers(
      uid,
      chat.id,
      chat.users.map((user) => user.id)
    )
  }
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
 * Если расшифровать нечем — подставляем заглушку, а не шифротекст.
 *
 * Список устройств участников меняется, а ключ чата могут перераспределить с
 * другого устройства — тогда при неудаче один раз перечитываем обёртки и
 * пробуем ещё раз, иначе переписка выглядела бы «замками» до перезапуска.
 */
const applyDecryptMessages = async (chatId: number, list: Message[]): Promise<Message[]> => {
  const need = list.filter((m) => m.encrypted && isEncryptedPayload(m.text))
  if (need.length === 0) return list
  const chat = chats.value.find((c) => c.id === chatId) ?? selectedChat.value
  let keys = await chatDecryptKeysOf(chat)
  const fallback = (m: Message): Message =>
    m.encrypted && isEncryptedPayload(m.text) ? { ...m, text: ENCRYPTED_FALLBACK } : m
  if (keys.length === 0) return list.map(fallback)

  let decoded = await decodeEncryptedList(list, keys)
  if (decoded.failed > 0 && chat !== null && !chat.is_group) {
    clearChatKeyCache(chatId)
    keys = await chatDecryptKeysOf(chat)
    if (keys.length > 0) decoded = await decodeEncryptedList(list, keys)
  }
  // Заранее запускаем расшифровку вложений: к моменту отрисовки/лайтбокса
  // картинки уже готовы (и грузятся один раз на сообщение).
  preloadDecryptedMedia(decoded.out)
  return decoded.out
}

/** Разбирает шифротекст списка ключами чата; `failed` — сколько не поддалось. */
const decodeEncryptedList = async (
  list: Message[],
  keys: CryptoKey[]
): Promise<{ out: Message[]; failed: number }> => {
  const out: Message[] = []
  let failed = 0
  for (const m of list) {
    if (!m.encrypted || !isEncryptedPayload(m.text)) {
      out.push(m)
      continue
    }
    const plain = await decryptTextWithKeys(keys, m.text)
    if (plain === null) {
      failed += 1
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
  return { out, failed }
}

const isOwnMessage = (message: Message): boolean =>
  currentUserId.value !== null && message.user_id === currentUserId.value

const startVoiceCall = () => {
  const chat = selectedChat.value
  if (isGroupCallChat(chat)) {
    startGroupCall('audio')
    return
  }
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
  if (isGroupCallChat(chat)) {
    startGroupCall('video')
    return
  }
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

/**
 * Годится ли чат для ГРУППОВОГО звонка: обычная группа (не канал и не
 * «Сохранённые сообщения»), где есть с кем разговаривать.
 */
const isGroupCallChat = (chat: Chat | null): boolean =>
  !!chat && !!chat.is_group && !chat.is_channel && !chat.is_self

/**
 * Групповой звонок «mesh»: звоним участникам группы (до четырёх человек вместе
 * со собой). Себя, каналы и удалённые аккаунты в список не берём.
 */
const startGroupCall = (kind: 'audio' | 'video') => {
  const chat = selectedChat.value
  if (!isGroupCallChat(chat) || currentUserId.value === null) return
  const members = (chat as Chat).users
    .filter((user) => user.id !== currentUserId.value)
    .map((user) => ({
      id: user.id,
      name: displayName(user),
      avatarUrl: user.avatar_thumb_url ?? user.avatar_url ?? null
    }))
  if (members.length === 0) return
  void callStore.startGroupCall((chat as Chat).id, members, kind)
}

/** Кнопка звонка в шапке чата: клик (без удержания) = звонок выбранного типа. */
const startCall = (kind: 'audio' | 'video') => {
  if (kind === 'video') startVideoCall()
  else startVoiceCall()
}

/**
 * Пока идёт групповой звонок, держим в сторе звонка имена участников: состав
 * сервер отдаёт только идентификаторами, и без этого в плитках было «@29».
 */
watch(
  () => [callStore.isGroup, callStore.callId, selectedChat.value?.id],
  () => {
    const chat = selectedChat.value
    if (!callStore.isGroup || !chat || chat.id !== callStore.groupChatId) return
    callStore.rememberPeerNames(
      chat.users.map((user) => ({
        id: user.id,
        name: displayName(user),
        avatarUrl: user.avatar_thumb_url ?? user.avatar_url ?? null
      }))
    )
  },
  { immediate: true }
)

// ---------- История звонков ----------
// Записи о звонках лежат в чатах системными сообщениями; отдельный экран
// собирает их в одну ленту (меню «⋯» → «Звонки»).
const callsOpen = ref(false)

/** Позвонить тем же типом, каким был звонок в записи. */
const startCallWithPeer = (peer: ChatUser, kind: 'audio' | 'video') => {
  void callStore.startCall(
    {
      id: peer.id,
      name: displayName(peer),
      // В экране звонка аватар — кружок: берём миниатюру, если она есть.
      avatarUrl: peer.avatar_thumb_url ?? peer.avatar_url ?? null
    },
    kind
  )
}

/** «Перезвонить» из истории: собеседника берём из самой записи (чат уже есть). */
const callBackFromHistory = (item: CallHistoryItem) => {
  if (!item.peer) return
  callsOpen.value = false
  startCallWithPeer(item.peer, item.call_kind === 'video' ? 'video' : 'audio')
}

/** Переход из записи в чат собеседника (посмотреть переписку). */
const openChatFromCalls = (item: CallHistoryItem) => {
  callsOpen.value = false
  void selectChat(item.chat_id)
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
  applyPresence,
  applyPresenceSnapshot,
  seedPresence,
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

/** Подмешивает присутствие из свежего ответа /chats (без выдумывания «в сети»). */
const syncPresenceFromChats = (list: Chat[]) => {
  for (const chat of list) {
    const other = otherUserOfChat(chat)
    if (!other) continue
    // Только время последней активности. Статус «в сети» приходит исключительно
    // по WS (`presence`/`presence.snapshot`), иначе получается ложный онлайн.
    seedPresence(other.id, other.last_seen ?? null)
  }
}

/**
 * Чат прочитан на другом моём устройстве — здесь значок непрочитанного гаснет.
 *
 * Без этого события телефон показывал «непрочитано» до перезагрузки, хотя чат
 * уже прочитан на компьютере: сервер сообщал о прочтении только собеседнику.
 */
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
  return lastSeenLabel(other.last_seen, false) || 'был(а) давно'
}

const chatSubtitle = (chat: Chat): string => {
  if (isPeerTyping(chat.id)) return 'печатает…'
  if (chat.is_channel) return channelSubtitle(chat)
  if (isGroupChat(chat)) return groupSubtitle(chat)
  return presenceText(chat)
}

/** Канал ли чат (по флагу сервера). */
const isChannelChat = (chat: Chat | null | undefined): boolean => !!chat?.is_channel

/** Открыт канал. */
const selectedIsChannel = computed<boolean>(() => isChannelChat(selectedChat.value))

/**
 * Может ли текущий человек публиковать в открытом канале.
 *
 * В канале пишут только владелец и админы; подписчики могут лишь
 * предлагать посты (см. кнопку «Предложить пост» у композера).
 */
const canPostInChannel = computed<boolean>(() => {
  if (!selectedIsChannel.value) return true
  const role = selectedChat.value?.my_role
  return role === 'creator' || role === 'admin'
})

/** Склонение слова «подписчик» по числу. */
const subscribersNoun = (count: number): string => {
  const last = count % 10
  const lastTwo = count % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'подписчиков'
  if (last === 1) return 'подписчик'
  if (last >= 2 && last <= 4) return 'подписчика'
  return 'подписчиков'
}

/** Подпись шапки канала: «канал · N подписчиков». */
const channelSubtitle = (chat: Chat): string => {
  const card = channelCard.value
  if (!card || card.id !== chat.id) return 'канал'
  return `канал · ${card.subscribers} ${subscribersNoun(card.subscribers)}`
}

// ---------- Ссылка на канал: https://pismo.space/c/<адрес> ----------
// Разбирается после входа и загрузки чатов: показываем экран подписки, а не
// сразу ленту (человек может быть ещё не подписан). Адрес из пути убираем —
// иначе после перезагрузки окно подписки открывалось бы заново.
const channelLinkUsername = ref<string | null>(
  typeof window === 'undefined' ? null : channelUsernameFromPath(window.location.pathname)
)

const openChannelLink = () => {
  const alias = channelLinkUsername.value
  if (!alias) return
  channelLinkUsername.value = null
  try {
    window.history.replaceState(window.history.state, '', '/')
  } catch {
    /* история недоступна (iframe) — адрес просто останется как есть */
  }
  channelOverlaysRef.value?.openJoin(alias)
}

/** Подписка по ссылке удалась: открываем канал. */
const onChannelJoined = async (channel: ChannelCard) => {
  await loadChats()
  const chat = chats.value.find((item) => item.id === channel.id)
  if (chat) {
    view.value = 'chats'
    await openChatThread(chat.id)
  }
}

// ---------- Каналы: карточка, счётчики постов, предложки ----------/** Карточка канала (шапка, настройки, число подписчиков). */
const loadChannelCard = async (chatId: number) => {
  if (!isChannelChat(chats.value.find((item) => item.id === chatId))) {
    channelCard.value = null
    return
  }
  try {
    channelCard.value = await fetchChannel(chatId)
  } catch (error) {
    console.error('Не удалось загрузить канал:', getErrorMessage(error))
  }
}

/** Счётчики загруженных постов канала (просмотры и комментарии). */
const loadChannelMeta = async (chatId: number) => {
  const ids = messages.value.map((message) => message.id)
  if (ids.length === 0) {
    channelPostMeta.value = {}
    return
  }
  try {
    const meta = await fetchPostsMeta(chatId, ids)
    const next: Record<number, { views: number; comments: number }> = {}
    for (const item of meta) {
      next[item.message_id] = { views: item.views, comments: item.comments }
    }
    channelPostMeta.value = next
  } catch (error) {
    console.error('Не удалось загрузить счётчики постов:', getErrorMessage(error))
  }
}

/** Пост канала доехал до экрана — считаем просмотр (один раз за показ ленты). */
const onPostViewed = async (message: Message) => {
  const chatId = selectedChatId.value
  if (chatId === null || !selectedIsChannel.value) return
  const current = channelPostMeta.value[message.id] ?? { views: 0, comments: 0 }
  // Счётчик поднимаем сразу, чтобы число менялось без ожидания ответа сервера.
  channelPostMeta.value = {
    ...channelPostMeta.value,
    [message.id]: { ...current, views: current.views + 1 }
  }
  try {
    await markPostViewed(chatId, message.id)
  } catch (error) {
    console.error('Не удалось отметить просмотр поста:', getErrorMessage(error))
  }
}

/**
 * Открыть комментарии к посту канала.
 *
 * Как в Telegram: это отдельный экран, поэтому на телефоне кладём шаг в историю
 * приложения — системная «назад» возвращает в ленту канала, а не из чата.
 */
const openChannelComments = (message: Message) => {
  pushMobileNav()
  channelOverlaysRef.value?.openComments(message)
}

/** Диалог комментариев сообщил новое число комментариев под постом. */
const onChannelCommentsCount = (payload: { messageId: number; count: number }) => {
  const current = channelPostMeta.value[payload.messageId] ?? { views: 0, comments: 0 }
  channelPostMeta.value = {
    ...channelPostMeta.value,
    [payload.messageId]: { ...current, comments: payload.count }
  }
}

/** «Предложить пост» (кнопка у канала, где подписчику писать нельзя). */
const openChannelSuggest = () => {
  channelOverlaysRef.value?.openSuggest()
}

/** Канал создан: список чатов обновляем и сразу открываем новый канал. */
const onChannelCreated = async (channel: ChannelCard) => {
  applyChatsFromServer(await fetchMyChats().catch(() => chats.value))
  const chat = chats.value.find((item) => item.id === channel.id)
  if (chat) {
    view.value = 'chats'
    await openChatThread(chat.id)
  }
}

/** Настройки канала изменились (название, описание, адрес) — обновляем список. */
const onChannelUpdated = async () => {
  await loadChats()
  const chatId = selectedChatId.value
  if (chatId !== null) await loadChannelCard(chatId)
}

/** Канал покинут/удалён — убираем его из списка и закрываем открытую ленту. */
const onChannelLeft = () => {
  const chat = selectedChat.value
  if (chat) removeDeletedChat(chat)
}

/** Карточка канала обновилась (в ней же счётчик подписчиков) — перечитываем. */
const refreshChannelCard = () => {
  const chatId = selectedChatId.value
  if (chatId !== null) void loadChannelCard(chatId)
}

// Лента канала изменилась (новый пост, подгрузка истории) — обновляем счётчики,
// иначе под свежими постами не было бы ни просмотров, ни числа комментариев.
watch(
  () => [selectedChatId.value, messages.value.length] as const,
  () => {
    const chatId = selectedChatId.value
    if (chatId === null || messages.value.length === 0) return
    if (!isChannelChat(chats.value.find((item) => item.id === chatId))) return
    void loadChannelMeta(chatId)
  },
  { flush: 'post' }
)

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

/**
 * Кто поставил реакцию: открывается удержанием чипа (или правым кликом).
 *
 * Тап по реакции ставит/снимает СВОЮ — это привычное действие, поэтому список
 * живёт на отдельном жесте.
 */
const reactionUsersFor = ref<{
  message: Message
  emoji: string
  /** Чип, у которого открывается список (или null — тогда по центру). */
  anchor: HTMLElement | null
} | null>(null)

const openReactionUsers = (message: Message, emoji: string, anchor: HTMLElement | null): void => {
  reactionUsersFor.value = { message, emoji, anchor }
}

// ---------- Загрузка данных ----------

/**
 * Применяет список чатов с сервера, но НЕ воскрешает непрочитанные у открытого
 * чата.
 *
 * Симптом: прочитал чат, а значок непрочитанного возвращался и держался до
 * перезагрузки. Причина — гонка: список чатов обновляется по WS-событию (и по
 * страховочному таймеру) быстрее, чем сервер успевает записать прочтение от
 * запроса истории, и ответ перетирал локальный ноль.
 */
const loadChats = async () => {
  loadingChats.value = true
  try {
    applyChatsFromServer(await fetchMyChats())
  } catch (error) {
    console.error('Не удалось загрузить чаты:', getErrorMessage(error))
  } finally {
    loadingChats.value = false
  }
}

// ---------- Пагинация истории ----------
//
// Свежая страница при открытии чата, догрузка вверх и склейка с загруженным —
// `composables/useThreadPagination.ts`.

const {
  messagesLoading,
  noMoreOlder,
  scrollToBottom,
  replaceMessageInThread,
  removeMessageFromThread,
  loadThreadLatest,
  mergeThreadLatest,
  loadOlderMessages
} = useThreadPagination({
  // Геттеры, а не значения: объявлены ниже по `<script setup>` (см. граблю TDZ
  // в шапке файла); расшифровка страницы — функция выше.
  messages,
  selectedChatId: () => selectedChatId.value,
  thread: () => threadRef.value,
  decryptPage: (chatId, list) => applyDecryptMessages(chatId, list)
})

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
  rememberUnreadAtOpen(chatId)
  selectedChatId.value = chatId
  // Открытый чат виден в адресе: перезагрузка вернёт в него же.
  syncChatUrl(chatId)
  sendError.value = ''
  void prepareChatE2ee(chatId)
  messages.value = []
  pinnedMessages.value = []
  resetScheduled()
  resetReminders()
  // Расшифровка голосовых читает файл этого чата — в другом она не нужна, а
  // `blob:`-ссылка вот-вот будет освобождена (releaseDecryptedMediaExcept).
  stopAllRecognitions()
  // В другом чате шторка закреплённых показывается снова.
  pinnedHidden.value = false
  clearPendingUploads()
  inlineQuery.value = ''
  inlineSearchOpen.value = false
  clearReply()
  closeLightbox()
  closeViewOnce()
  showChatInfoModal.value = false
  reactionUsersFor.value = null
  showGroupInfoModal.value = false
  // Канал: состояние прошлого канала больше не нужно.
  channelOverlaysRef.value?.closeAll()
  channelCard.value = null
  channelPostMeta.value = {}
  await Promise.all([
    loadThreadLatest(chatId),
    loadPinned(chatId),
    loadScheduled(chatId),
    loadReminders(chatId)
  ])
  // Канал: карточка для шапки и счётчики постов для загруженной части ленты.
  if (isChannelChat(chats.value.find((item) => item.id === chatId))) {
    void loadChannelCard(chatId)
    void loadChannelMeta(chatId)
  }
  // Blob-ссылки расшифрованных вложений других чатов больше не нужны.
  releaseDecryptedMediaExcept(messages.value.map((message) => message.id))
  // Мы читаем чат — непрочитанные обнуляем сразу (не дожидаясь синхронизации).
  clearUnreadOfOpenChat()
  // Ждём отрисовки сообщений + два кадра, иначе scrollTop посчитается по ещё
  // не размеченной ленте и чат откроется не внизу (нужно докручивать).
  await nextTick()
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
  scrollToBottom()
  // Телефон: выбор чата закрывает drawer — нить на весь экран.
  // Запоминаем шаг в истории, чтобы системная «назад» вернула к списку.
  if (isPhone.value) {
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
    if (isPhone.value) {
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
/**
 * Доставка текста: E2EE, отправка, показ в ленте.
 *
 * Общая для обычного сообщения и для стикера (стикер — это тоже текст из
 * эмодзи): различается только то, что делает вызывающий до и после.
 */
const deliverText = async (chatId: number, text: string, replyTo: number | null) => {
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
  const message = await sendNewMessage(chatId, wireText, replyTo, wireEncrypted)
  if (wireEncrypted) {
    // Локально в ленте показываем открытый текст; шифротекст живёт на сервере.
    message.text = text
    message.encrypted = false
  }
  await refreshThread()
  messages.value = appendMessage(messages.value, message)
  await loadPinned(chatId)
  // Короткий отклик при отправке: понятно, что сообщение ушло, не сверяясь
  // с галочками (на телефоне ощущается как «нажалось»).
  haptic()
  scrollToBottom()
}

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

    await deliverText(chatId, text, replyTarget.value?.id ?? null)
    newMessage.value = ''
    clearDraftFor(chatId)
    sendTypingStop(chatId)
    clearReply()
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

// ---------- Отложенная отправка («отправить позже») ----------
//
// Очередь живёт на сервере (её разбирает Celery beat, поэтому сообщение уйдёт и с
// закрытым приложением), а список и создание/отмена — в
// `composables/useScheduledSend.ts`.

const {
  scheduledMessages,
  scheduledDecrypted,
  loadScheduled,
  resetScheduled,
  scheduleSend,
  cancelScheduled
} = useScheduledSend({
  // Геттеры, а не значения: объявлены ниже по `<script setup>`, а читаются по
  // действию человека (см. граблю TDZ в шапке файла).
  composerText: newMessage,
  sending,
  selectedChat: () => selectedChat.value,
  selectedChatId: () => selectedChatId.value,
  replyToId: () => replyTarget.value?.id ?? null,
  chatKeyOf: (chat) => chatKeyOf(chat),
  onScheduled: (chatId) => {
    clearDraftFor(chatId)
    clearReply()
    sendTypingStop(chatId)
  },
  onError: (message) => {
    sendError.value = message
  }
})

// ---------- Напоминания о сообщении («напомнить мне») ----------
//
// «Верни меня к этой строке»: список напоминаний открытого чата, значок у времени
// и диалог выбора срока. Сама тема живёт в `composables/useMessageReminders.ts` —
// здесь только связь с лентой сообщений и плашкой ошибки.

const {
  reminderTarget,
  reminderBusy,
  reminderFor,
  reminderAtOf,
  reminderPreview,
  loadReminders,
  resetReminders,
  openReminderDialog,
  saveReminder,
  removeReminder,
  closeReminderDialog
} = useMessageReminders({
  // Геттеры, а не значения: `selectedChatId` объявлен ниже, а вызывает их
  // composable только по действию человека (см. граблю TDZ в шапке файла).
  selectedChatId: () => selectedChatId.value,
  onError: (message) => {
    sendError.value = message
  }
})

/**
 * Отправляет стикер (эмодзи) отдельным сообщением — тап в панели «Стикеры».
 *
 * Черновик в поле ввода НЕ трогаем: человек мог параллельно набирать текст, а
 * стикер — отдельное сообщение. В ленте оно рисуется крупно и без пузыря
 * (`MessageRow.vue`, `emojiLayout`).
 */
const sendSticker = async (sticker: string) => {
  const chatId = selectedChatId.value
  if (chatId === null || !sticker || sending.value) return
  sending.value = true
  sendError.value = ''
  try {
    await deliverText(chatId, sticker, replyTarget.value?.id ?? null)
    clearReply()
  } catch (error) {
    if (isNetworkError(error)) {
      queueOutgoingText(chatId, sticker, replyTarget.value?.id)
      clearReply()
      void nextTick(scrollToBottom)
    } else {
      sendError.value = getErrorMessage(error, 'Не удалось отправить стикер')
    }
  } finally {
    sending.value = false
  }
}

const appendMessage = (list: Message[], message: Message): Message[] => {
  if (list.some((item) => item.id === message.id)) return list
  return [...list, message]
}

/** Ошибка добавления стикера (из панели стикеров): показываем в строке ошибок. */
const onStickerError = (message: string) => {
  sendError.value = message
}

/**
 * «В стикеры» из сообщения: сервер копирует картинку в пак по умолчанию.
 *
 * Пункт показывается только там, где сервер может прочитать файл (обычный чат),
 * поэтому расшифровывать на клиенте нечего: см. `canBecomeSticker`.
 */
const makeStickerFromMessage = async (message: Message) => {
  sendError.value = ''
  try {
    await stickerFromMessage(message.id)
    // Библиотека изменилась — панель стикеров должна увидеть новый стикер сразу.
    await stickerStore.load(true)
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось добавить стикер')
  }
}

/**
 * «Добавить набор» из меню стикера — как «Добавить стикеры» в Телеграме.
 *
 * Так работают только ВСТРОЕННЫЕ наборы: метка `st-…` в имени файла говорит, какой
 * это набор (`utils/presetStickers.ts`). Стикеры из серверных наборов (своих и
 * публичных) добавляются из окна набора — тап по стикеру в ленте.
 */
const { run: runStandardSetImport } = useStandardSetImport()

const addStickerSet = (message: Message) => {
  // Имя берём из эффективного вложения: в E2EE в `message.file.name` лежит
  // нейтральное `enc_*.bin`, а метка набора — в расшифрованном конверте.
  const set = presetSetOfFileName(effectiveFile(message)?.name ?? null)
  if (!set) return
  void runStandardSetImport(set).then((problem) => {
    if (problem) sendError.value = problem
  })
}

/** Открытый набор стикера (окно): null — окно закрыто. */
const stickerSet = ref<StickerSetRef | null>(null)

/**
 * Тап по стикеру в ленте: показываем его набор — как в Телеграме.
 *
 * Набор узнаём по метке в имени файла (`utils/presetStickers.ts`): `st-…` —
 * встроенный, `sp-<id>` — свой или публичный с сервера. Метки нет (старый стикер,
 * чужой личный набор, обычная картинка) — ведём себя как раньше и открываем
 * просмотр картинки: обещать нечего.
 */
const openStickerSetOf = async (message: Message) => {
  // Имя — из эффективного вложения: у E2EE-стикера настоящее имя (с меткой
  // набора) лежит в расшифрованном конверте, а `message.file.name` — `enc_*.bin`.
  // Без этого тап по стикеру в зашифрованном чате открывал просмотр картинки.
  const fileName = effectiveFile(message)?.name ?? null
  const packId = packIdOfFileName(fileName)
  let set = resolveStickerSet(fileName, stickerStore.packs, stickerStore.presets)
  if (!set && packId !== null) {
    // Списки могли быть ещё не загружены (панель стикеров не открывали) —
    // подтягиваем и пробуем снова: без них серверный набор не опознать.
    await Promise.all([stickerStore.load(), stickerStore.loadPresets()])
    set = resolveStickerSet(fileName, stickerStore.packs, stickerStore.presets)
  }
  if (set) stickerSet.value = set
  else openImageFromMessage(message)
}

/**
 * Отправляет стикер-картинку сообщением (тап в панели «Стикеры»).
 *
 * Стикер скачиваем по ссылке и отправляем теми же байтами, что обычное
 * вложение, только с ``sticker=true``: сообщение получает ``kind='sticker'`` и
 * рисуется без пузыря. Ссылка приходит готовая — свои стикеры лежат на сервере
 * (`media/`), стандартные — ассеты приложения (`public/stickers/`).
 * В E2EE-чате байты сначала шифруются — как и любое другое вложение.
 */
const sendStickerImage = async (image: {
  url: string
  mime: string
  /** Встроенный набор приложения: метка `st-<набор>-<имя>.png`. */
  preset?: { setKey: string; name: string }
  /** Набор с сервера: метка `sp-<id>-<имя>.png` (свой или публичный). */
  pack?: { packId: number; position: number }
}) => {
  const chatId = selectedChatId.value
  if (chatId === null || sending.value) return
  sending.value = true
  sendError.value = ''
  try {
    const response = await fetch(image.url)
    if (!response.ok) throw new Error('Не удалось прочитать стикер')
    const blob = await response.blob()
    // Имя файла несёт метку набора: по ней получатель поймёт, из какого набора
    // стикер, и сможет открыть его целиком — см. utils/presetStickers.ts.
    const fileName = image.preset
      ? presetStickerFileName(image.preset.setKey, image.preset.name)
      : image.pack
        ? packStickerFileName(image.pack.packId, String(image.pack.position))
        : 'sticker.webp'
    const file = new File([blob], fileName, {
      type: image.mime || blob.type || 'image/webp'
    })
    const aes = await chatKeyOf(selectedChat.value)
    const payload = aes ? await encryptFileForChat(aes, file, '') : null
    const message = await sendAttachmentMessage(
      chatId,
      payload ? payload.blob : file,
      payload ? payload.text : '',
      replyTarget.value?.id ?? null,
      undefined,
      !!payload,
      true
    )
    if (payload) applyLocalFileEnvelope(message, payload.meta)
    clearReply()
    sendTypingStop(chatId)
    messages.value = appendMessage(messages.value, message)
    scrollToBottom()
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось отправить стикер')
  } finally {
    sending.value = false
  }
}

/**
 * Отправка одного файла: временный пузырь с прогрессом → сжатие фото → E2EE →
 * загрузка. На ошибке бросает исключение (почистив за собой временный пузырь) —
 * что показать пользователю, решает вызывающий: отправка одного файла или пачки.
 */
const sendFileMessage = async (file: File, viewOnce = false) => {
  const chatId = selectedChatId.value
  if (chatId === null) return

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
      !!payload,
      // Стикером это не отправляем, а «посмотреть один раз» — флаг сообщения.
      false,
      viewOnce
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
    throw error
  } finally {
    sendingFile.value = false
  }
}

/**
 * Отправка файлов: кнопка «Прикрепить», вставка из буфера и перетаскивание в
 * окно. Файлы уходят по очереди, каждый — отдельным сообщением (альбомов в
 * модели сообщений нет). Подпись из поля ввода достаётся первому файлу: после
 * него поле очищается — ровно как при отправке одного файла.
 */
const sendFiles = async (files: File[], viewOnce = false) => {
  if (selectedChatId.value === null || files.length === 0) return
  sendError.value = ''
  const failures: string[] = []
  for (const file of files) {
    try {
      await sendFileMessage(file, viewOnce)
    } catch (error) {
      // Один неудачный файл не отменяет остальные: копим причины и показываем
      // итог после всей пачки.
      failures.push(getErrorMessage(error, `Не удалось отправить «${file.name}»`))
    }
  }
  if (failures.length === 1) sendError.value = failures[0]
  else if (failures.length > 1) {
    sendError.value = `Не удалось отправить ${failures.length} из ${files.length} файлов`
  }
}

/** Кнопка «Прикрепить» и вставка картинки из буфера — всегда один файл. */
const onFileSelected = (file: File, viewOnce = false) => {
  void sendFiles([file], viewOnce)
}

/**
 * Файлы, брошенные в окно. Нужен именно открытый (загруженный) чат: пока чат
 * восстанавливается из адреса, ключа E2EE ещё нет — файл уехал бы на сервер
 * открытым. О том же говорит и подсказка (FileDropOverlay, `canDropFiles`).
 */
const handleDroppedFiles = (files: File[]) => {
  if (selectedChat.value === null) {
    Notify.create({ message: 'Откройте чат, чтобы отправить файл', timeout: 3000 })
    return
  }
  void sendFiles(files)
}

/* Файл можно бросить в любое место окна — слушатели живут в composable. */
const { active: fileDropActive } = useFileDrop({ onFiles: handleDroppedFiles })
/** Отправлять есть куда: чат открыт (пока он грузится, подсказка нейтральная). */
const canDropFiles = computed(() => selectedChat.value !== null)

// ---------- Запись аудио/видеосообщений ----------
const {
  voiceRecOpen,
  videoRecOpen,
  openVoiceRec,
  onVoiceCancel,
  onVoiceSend,
  openVideoRec,
  onVideoCancel,
  onVideoSend
} = useMediaRecording({
  selectedChatId: () => selectedChatId.value,
  selectedChat: () => selectedChat.value,
  replyToId: () => replyTarget.value?.id,
  prepare: closePopups,
  resetRecordMode: () => resetRecordMode(),
  chatKeyOf,
  addPendingUpload,
  removePendingUpload,
  setPendingProgress,
  hasPendingUpload: (localId) => pendingUploads.value.some((p) => p.localId === localId),
  applyLocalFileEnvelope,
  appendToThread: (message) => {
    messages.value = appendMessage(messages.value, message)
  },
  loadPinned,
  refreshChats: loadChats,
  clearReply: () => clearReply(),
  stopTyping: (chatId) => sendTypingStop(chatId),
  scrollToBottom,
  nextTick: (callback) => void nextTick(callback),
  setSendingFile: (value) => {
    sendingFile.value = value
  },
  setSendError: (message) => {
    sendError.value = message
  }
})

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

/**
 * Собрать текст для отправки: в «зашифрованном» чате шифруем в момент отправки
 * (в очереди и в черновике текст лежит открытым — ключи могут появиться позже).
 *
 * Нужен очереди (`useOutbox`) и черновикам (`useDrafts`) — отправка обычного
 * сообщения шифрует у себя в `deliverText`: там к шифрованию прицеплено ещё и
 * состояние «собеседник готов к E2EE».
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

// ---------- Очередь сообщений, которые не ушли из-за сети ----------
//
// Очередь, автоотправка при возврате связи и ручной повтор живут в
// `composables/useOutbox.ts` — здесь строки очереди для ленты и обновление
// открытого чата после доставки.

const {
  openChatOutboxRows,
  queueOutgoingText,
  flushOutbox,
  retryOutboxItem,
  dropOutboxItem,
  startOutboxTimer
} = useOutbox({
  // Геттеры, а не значения: объявлены ниже по `<script setup>` (`online` — в самом
  // конце, у realtime-связи), а читаются они по действию человека и по таймеру.
  currentUserId: () => currentUserId.value,
  selectedChatId: () => selectedChatId.value,
  isOnline: () => online.value,
  buildWireText: (chatId, text) => buildWireText(chatId, text),
  // Доставленное показываем сразу в открытом чате: лента, закреплённые, вниз.
  onDelivered: (message, chatId) => {
    messages.value = appendMessage(messages.value, message)
    void loadPinned(chatId)
    void nextTick(scrollToBottom)
  },
  reloadChats: () => loadChats()
})

/** Строки под лентой: загружаемые вложения + очередь сообщений. */
const threadPendingRows = computed<PendingRow[]>(() => [
  ...pendingUploads.value.map((item) => ({ ...item, status: 'sending' as const })),
  ...openChatOutboxRows.value
])
// ---------- Догрузка, когда связь вернулась ----------
/**
 * Связь вернулась: досылаем застрявшее и добираем то, что пропустили за время
 * обрыва (список чатов, открытая переписка, лента историй). Пока это идёт, плашка
 * сверху пишет «Соединение…» — человек видит, что приложение работает.
 */
const onConnectionRestored = async () => {
  setConnectionSyncing(true)
  try {
    await Promise.all([
      flushOutbox(),
      refreshChatsQuiet(),
      refreshOpenThreadQuiet(),
      storiesStore.load()
    ])
  } finally {
    setConnectionSyncing(false)
  }
}

// ---------- Мультивыделение сообщений (long-press; как в чатах) ----------
//
// Режим выбора, отметки и массовые действия (переслать, сохранить в «Сохранённые»,
// удалить) живут в `composables/useMessageSelection.ts` — здесь только связь с
// лентой и панелью выбора.

const {
  messageSelection,
  selectedMessageIds,
  allVisibleMessagesSelected,
  exitMessageSelection,
  startMessageSelection,
  toggleMessageSelect,
  toggleSelectAllMessages,
  bulkForwardMessages,
  bulkSaveMessagesToSelf,
  bulkDeleteMessages
} = useMessageSelection({
  // Геттеры, а не значения: они объявлены ниже по `<script setup>`, а читает их
  // composable только по действию человека (см. граблю TDZ в шапке файла).
  messages: () => messages.value,
  chats: () => chats.value,
  selectedChat: () => selectedChat.value,
  selectedChatId: () => selectedChatId.value,
  currentUserId: () => currentUserId.value,
  closeEmojiPicker: () => {
    emojiPickerFor.value = null
  },
  closePopups: () => closePopups(),
  clearReply: () => clearReply(),
  isEditing: () => editingMessage.value !== null,
  cancelEditing: () => cancelEditing(),
  isForwarding: () => forwardSource.value !== null,
  cancelForward: () => cancelForward(),
  openForward: (sources) => openForward(sources),
  removeMessageFromThread: (messageId) => removeMessageFromThread(messageId),
  reloadChats: () => loadChats(),
  reloadPinned: (chatId) => loadPinned(chatId),
  askDeleteScope: (payload) => askDeleteScope(payload)
})

// Навигация: адрес `?chat=`, история приложения и системная «назад». Вызов здесь,
// потому что ниже объявлены слои интерфейса, которые «назад» закрывает
// (режим выбора, карточка приглашения), а выше — раздел и выбранный чат.
const { syncChatUrl, goBackToList, pushMobileNav, revealDrawer, onAppPopState } = useChatNavigation(
  {
    twoPane,
    view,
    drawerOpen,
    selectedChatId,
    chatSelection: () => sidebarRef.value?.isSelecting() ?? false,
    exitChatSelection: () => sidebarRef.value?.exitSelection(),
    layers: {
      storyId: openStoryId,
      lightboxIndex,
      commentsOpen: () => channelOverlaysRef.value?.isCommentsOpen() ?? false,
      profileOpen: showProfileModal,
      chatInfoOpen: showChatInfoModal,
      groupInfoOpen: showGroupInfoModal,
      createGroupOpen: showCreateGroupModal,
      messageSelection,
      inviteOpen: () => inviteDialogOpen.value
    },
    hooks: {
      profileInSection: () => profileRef.value?.isInSection() ?? false,
      backToProfileSections: () => profileRef.value?.backToSections(),
      closeComments: () => channelOverlaysRef.value?.closeComments(),
      closeInvite: () => closeInviteDialog(),
      exitMessageSelection: () => exitMessageSelection(),
      closeOpenChat: () => closeOpenChat()
    }
  }
)

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

// ---------- Черновики сообщений (локально + на сервере) ----------
//
// Локальная копия (localStorage, ключ `userId:chatId`) и серверная (черновик виден
// с другого устройства; в зашифрованном чате уходит шифротекстом). Тема целиком в
// `composables/useDrafts.ts` — здесь только связь с полем ввода и жизненным циклом
// страницы.

const {
  draftsByChatId,
  saveDraftFor,
  loadDraftFor,
  clearDraftFor,
  flushDraftPushes,
  syncDraftsFromServer,
  setComposerText,
  isProgrammaticComposerEdit
} = useDrafts({
  // Геттеры, а не значения: объявлены ниже по `<script setup>`, а читаются они по
  // действию человека (см. граблю TDZ в шапке файла).
  composerText: newMessage,
  currentUserId: () => currentUserId.value,
  chats: () => chats.value,
  isEditing: () => editingMessage.value !== null,
  buildWireText: (chatId, text) => buildWireText(chatId, text),
  chatDecryptKeys: (chat) => chatDecryptKeysOf(chat)
})

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

/**
 * Вернулись в приложение: открытый чат считаем прочитанным.
 *
 * Пока окно было свёрнуто, сообщения копились непрочитанными; значок должен
 * погаснуть сразу при возврате, а не после перезагрузки страницы. Запрос истории
 * заодно отмечает прочтение на сервере.
 */
/** Локальная чистка после удаления чата (список/черновик/пин/архив/открытый тред). */
const removeDeletedChat = (chat: Chat) => {
  chats.value = chats.value.filter((item) => item.id !== chat.id)
  clearDraftFor(chat.id)
  if (pinnedChatIds.value.includes(chat.id)) toggleChatPinned(chat.id)
  // Чата больше нет — в архиве ему делать нечего (иначе останется мусорный id).
  if (archivedChatIds.value.includes(chat.id)) toggleChatArchived(chat.id)
  // Mute снимается на сервере самим удалением/выходом из чата.
  if (selectedChatId.value === chat.id) {
    selectedChatId.value = null
    syncChatUrl(null)
    messages.value = []
    pinnedMessages.value = []
    highlightedMessageId.value = null
    closeLightbox()
    showChatInfoModal.value = false
    reactionUsersFor.value = null
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

/** Подтверждение из модалки удаления: убираем выбранные чаты (для себя/для всех). */
const onDeleteChatConfirmed = async ({ ids, forAll }: { ids: number[]; forAll: boolean }) => {
  const targets = ids
    .map((id) => chats.value.find((item) => item.id === id))
    .filter((chat): chat is Chat => chat !== undefined)
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

// Пересылка: выбор чатов, отправка и состояние диалога — в useForward.
const {
  source: forwardSource,
  busy: forwardBusy,
  open: openForward,
  cancel: cancelForward,
  send: sendForward
} = useForward({
  selectedChatId: () => selectedChatId.value,
  appendToThread: (message) => {
    messages.value = appendMessage(messages.value, message)
  },
  loadPinned: (chatId) => loadPinned(chatId),
  refreshChats: () => loadChats(),
  stopTyping: (chatId) => sendTypingStop(chatId),
  prepare: () => {
    cancelEditing()
    closePopups()
  }
})

// ---------- Удаление сообщений: «только у меня» или «для всех» ----------
//
// Область выбирает человек в диалоге (`DeleteMessageDialog`), и диалог один на
// два входа — удаление одного сообщения и удаление выделенных: вариантов два, а
// «для всех» необратимо у собеседника, поэтому молча его выбирать нельзя.
const deleteMessageCount = ref(0)
const deleteMessageCanForAll = ref(false)
const showDeleteMessageDialog = ref(false)
/** Ожидающий ответа диалог: промис разрешается выбором человека. */
let deleteScopeResolve: ((scope: 'me' | 'all' | null) => void) | null = null

const askDeleteScope = (payload: {
  count: number
  canForAll: boolean
}): Promise<'me' | 'all' | null> => {
  deleteMessageCount.value = payload.count
  deleteMessageCanForAll.value = payload.canForAll
  showDeleteMessageDialog.value = true
  return new Promise((resolve) => {
    deleteScopeResolve = resolve
  })
}

/**
 * Подпись галки: в личном чате — имя собеседника (как в подписи чата), в группе —
 * «Удалить для всех». Пустая строка — галки нет: в «Сохранённых сообщениях»
 * удалять «для кого-то» нечего, там сообщение и так только моё.
 */
const deleteForAllLabel = computed<string>(() => {
  const chat = selectedChat.value
  if (!chat || chat.is_self) return ''
  return isPrivateChat(chat)
    ? `Удалить для ${chatTitle(chat, currentUserId.value)}`
    : 'Удалить для всех'
})

/** Пояснение под отмеченной галкой: без него «вернуть нельзя» остаётся догадкой. */
const deleteForAllHint = computed<string>(() => {
  const chat = selectedChat.value
  if (!chat || chat.is_self) return ''
  const many = deleteMessageCount.value > 1
  if (isPrivateChat(chat)) {
    const name = chatTitle(chat, currentUserId.value)
    return `${many ? 'Исчезнут' : 'Исчезнет'} и у ${name} — вернуть нельзя.`
  }
  return `${many ? 'Исчезнут' : 'Исчезнет'} у всех участников — вернуть нельзя.`
})

/** Ответ диалога: `null` — отмена или закрытие окна. */
const finishDeleteScope = (scope: 'me' | 'all' | null): void => {
  showDeleteMessageDialog.value = false
  const resolve = deleteScopeResolve
  deleteScopeResolve = null
  resolve?.(scope)
}

const deleteMessageOf = async (message: Message) => {
  const scope = await askDeleteScope({
    count: 1,
    canForAll: message.user_id === currentUserId.value
  })
  if (scope === null) return
  try {
    await deleteMessage(message.id, scope === 'all')
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

/**
 * Скрывает/показывает шторку закреплённых.
 * Скрытие — личное дело пользователя (крестик или пункт меню), но оно не должно
 * быть безвозвратным: вернуть шторку можно кнопкой-булавкой в шапке чата или тем
 * же пунктом меню «⋯» → «Показать закреплённые». При показе список раскрываем,
 * иначе пользователь увидит свёрнутую строку без содержимого.
 */
const togglePinnedBar = () => {
  pinnedHidden.value = !pinnedHidden.value
  if (!pinnedHidden.value) pinnedOpen.value = true
}

// ---------- Поиск по сообщениям ----------
const toggleInlineSearch = () => {
  inlineSearchOpen.value = !inlineSearchOpen.value
  if (!inlineSearchOpen.value) inlineQuery.value = ''
}

// ---------- Поиск по сообщениям (серверный) ----------
let inlineSearchTimer: number | null = null
const serverMatchCount = ref(0)
/** Найденные совпадения (по возрастанию) и номер того, что показано сейчас. */
const inlineMatches = ref<{ id: number }[]>([])
const inlineMatchIndex = ref(0)

/**
 * Переход к совпадению по кругу: после последнего снова первое.
 *
 * Поиск серверный, поэтому совпадение может лежать в ещё не загруженной части
 * истории — `ensureMessageLoaded` догружает нужную страницу и не даёт ленте
 * «прыгнуть» (см. выше).
 */
const goToInlineMatch = async (delta: number) => {
  const total = inlineMatches.value.length
  if (total === 0) return
  inlineMatchIndex.value = (inlineMatchIndex.value + delta + total) % total
  const match = inlineMatches.value[inlineMatchIndex.value]
  const loaded = await ensureMessageLoaded(match.id)
  if (loaded) await revealMessageInThread(match.id)
}

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
    inlineMatches.value = []
    inlineMatchIndex.value = 0
    return
  }
  const results = await searchMessages(query, chatId)
  serverMatchCount.value = results.length
  inlineMatches.value = results.map((message) => ({ id: message.id }))
  if (results.length === 0) {
    inlineMatchIndex.value = 0
    return
  }

  // Показываем САМОЕ СВЕЖЕЕ совпадение: с него начинают смотреть, а дальше по
  // стрелкам уходим вглубь истории (счётчик при этом показывает «N из M»).
  inlineMatchIndex.value = results.length - 1
  const newest = results[results.length - 1]
  const loaded = await ensureMessageLoaded(newest.id)
  if (loaded) await revealMessageInThread(newest.id)
}

watch(inlineQuery, (value) => {
  if (inlineSearchTimer !== null) {
    window.clearTimeout(inlineSearchTimer)
    inlineSearchTimer = null
  }
  if (!value.trim() || selectedChatId.value === null) {
    serverMatchCount.value = 0
    inlineMatches.value = []
    inlineMatchIndex.value = 0
    return
  }
  inlineSearchTimer = window.setTimeout(() => {
    inlineSearchTimer = null
    void runInlineServerSearch().catch((error) => {
      console.error('Не удалось выполнить поиск по сообщениям:', getErrorMessage(error))
    })
  }, 350)
})

// ---------- Эмодзи / стикеры / GIF в поле ввода ----------
const appendEmoji = (emoji: string) => {
  newMessage.value = `${newMessage.value}${emoji}`
}

const toggleExtras = () => {
  extrasPanel.value = extrasPanel.value === 'none' ? extrasTab.value : 'none'
}

const setExtrasTab = (tab: 'emoji' | 'stickers' | 'gif') => {
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
    applyChatsFromServer(await fetchMyChats())
  } catch (error) {
    console.error('Не удалось обновить чаты:', getErrorMessage(error))
  }
}

const refreshOpenThreadQuiet = async () => {
  const chatId = selectedChatId.value
  if (chatId === null) return
  try {
    await mergeThreadLatest(chatId)
    // Канал: вместе с лентой обновляем счётчики постов (просмотры, комментарии).
    if (isChannelChat(chats.value.find((item) => item.id === chatId))) {
      void loadChannelMeta(chatId)
    }
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
const {
  unreadAtOpen,
  applyChatsFromServer,
  rememberUnreadAtOpen,
  clearUnreadDivider,
  clearUnreadOfOpenChat,
  onChatReadElsewhere,
  markChatReadQuietly,
  handleVisibilityForUnread
} = useChatUnreadState({
  chats,
  selectedChatId,
  isAuthenticated: () => authStore.isAuthenticated,
  fetchMessages,
  refreshOpenThreadQuiet,
  syncPresenceFromChats
})

// ---------- Уведомления о новых сообщениях + счётчик в заголовке вкладки ----------
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

/** Озвучивает событие скринридеру (текст гаснет сам, иначе повтор не слышен). */
const announceLiveMessage = (text: string) => {
  liveAnnouncement.value = text
  if (announcementTimer !== undefined) window.clearTimeout(announcementTimer)
  announcementTimer = window.setTimeout(() => {
    liveAnnouncement.value = ''
    announcementTimer = undefined
  }, 4000)
}

const announceIncomingMessage = (chatId: number) => {
  // В открытом чате сообщение и так видно — не мешаем лишней речью.
  if (chatId === selectedChatId.value && !document.hidden) return
  const chat = chats.value.find((item) => item.id === chatId)
  const who = chat ? chatTitle(chat, currentUserId.value) : ''
  announceLiveMessage(who ? `Новое сообщение: ${who}` : 'Новое сообщение')
}

/**
 * Стоит ли молчать о новом сообщении (звук в приложении).
 *
 * Мьют чата — это «не беспокоить» целиком, а не только про push: если человек
 * заглушил чат, звук в приложении тоже не нужен. В открытом и активном чате
 * сообщение и так перед глазами, поэтому не звеним. Тихие часы считаем те же,
 * что и сервер (`utils/quietHours.ts`): push он глушит, а «блип» внутри
 * страницы решает клиент — и обязан считать так же, иначе ночью всё равно звенит.
 */
const shouldSilenceMessageSound = (chatId: number): boolean => {
  if (mutedChatIds.value.includes(chatId)) return true
  if (chatId === selectedChatId.value && document.hasFocus()) return true
  return isQuietHoursNow(authStore.current_user?.profile)
}

/** Входящее сообщение от собеседника: звук (если уместно) и озвучивание. */
const handleIncomingMessage = (chatId: number) => {
  if (!shouldSilenceMessageSound(chatId)) {
    // У чата может быть свой звук («Без звука» в диалоге «Звук уведомлений»).
    playIncomingMessageSound(chatSoundKey(chatId) ?? 'default')
  }
  announceIncomingMessage(chatId)
}

/**
 * Реакция на мою историю: автор узнаёт о ней, пока приложение открыто.
 *
 * Тихо обновляем ленту (счётчики в панели реакций и в «Аудитории»), а незрячему
 * пользователю объявляем голосом: всплывающих тостов в приложении намеренно нет
 * (история всё равно уже на экране), push приходит, когда приложение закрыто.
 */
const handleStoryReaction = (event: { name: string; emoji: string }) => {
  void storiesStore.load()
  announceLiveMessage(`${event.name}: реакция на вашу историю`)
}

/**
 * Ответ на историю текстом: уходит сообщением в личный чат автора.
 *
 * Просмотрщик при этом не закрываем — человек продолжает листать истории, как
 * в Instagram. Чат открываем молча (по необходимости создаём), сообщение несёт
 * снимок истории: `reply_to_story_id`, чтобы собеседник видел, на что отвечают.
 */
const replyToStory = async (payload: { storyId: number; authorId: number; text: string }) => {
  try {
    const chat = await openPrivateChat(payload.authorId)
    upsertChat(chat)
    // Шифрование — по тому же правилу, что и обычная отправка: только если
    // у обеих сторон есть ключи (e2ee_enabled). Иначе текст уходит открытым.
    let wireText = payload.text
    let wireEncrypted = false
    const aes = await chatKeyOf(chat)
    if (aes) {
      wireText = await encryptText(aes, payload.text)
      wireEncrypted = true
    }
    const message = await sendNewMessage(chat.id, wireText, null, wireEncrypted, payload.storyId)
    if (wireEncrypted) {
      // В ленте показываем открытый текст; шифротекст живёт на сервере.
      message.text = payload.text
      message.encrypted = false
    }
    // Дописываем в ленту только если этот чат уже открыт — иначе хватит тоста.
    if (selectedChatId.value === chat.id) {
      messages.value = appendMessage(messages.value, message)
      scrollToBottom()
    }
    void refreshChatsQuiet()
    haptic()
  } catch (error) {
    Notify.create({
      message: getErrorMessage(error, 'Не удалось отправить ответ'),
      color: 'negative',
      timeout: 3000
    })
  }
}

// Связь (для очереди «Ждёт сети»): состояние общее с плашкой «нет подключения».
const { online } = useOnlineStatus()

const { start: startRealtime, stop: stopRealtime } = useRealtimeSync({
  isAuthenticated: () => authStore.isAuthenticated,
  isMe: (userId) => userId === currentUserId.value,
  getSelectedChatId: () => selectedChatId.value,
  onPresence: applyPresence,
  onPresenceSnapshot: applyPresenceSnapshot,
  onChatReadElsewhere,
  onTyping: markPeerTyping,
  onTypingStop: clearPeerTyping,
  onChatsSync: refreshChatsQuiet,
  onThreadSync: refreshOpenThreadQuiet,
  onMessageNew: handleIncomingMessage,
  onChatRemoved: handleChatRemoved,
  onStoryReaction: handleStoryReaction
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
  if (isProgrammaticComposerEdit()) return
  const now = Date.now()
  if (now - lastTypingSentAt >= TYPING_SEND_INTERVAL_MS) {
    lastTypingSentAt = now
    realtimeStore.send({ type: 'typing', chat_id: chatId })
  }
})

// ---------- Навигация ----------
/** Открывает полноэкранный просмотр истории. */
const openStory = (storyId: number) => {
  pushMobileNav()
  openStoryId.value = storyId
}

/**
 * Открывает историю из push-уведомления: сначала добираем ленту.
 *
 * Просмотрщик ищет историю в уже загруженных группах, поэтому без свежей ленты
 * окно открылось бы пустым — это самое неприятное, что можно показать по тапу
 * в уведомлении.
 */
const openStoryFromPush = async (storyId: number) => {
  const known = () =>
    storiesStore.groups.some((group) => group.items.some((item) => item.id === storyId))
  if (!storiesStore.loaded) await storiesStore.load()
  // Лента могла устареть: приложение работало давно, а история только что
  // появилась. Один догоняющий запрос — и показываем то, ради чего открыли.
  if (!known()) await storiesStore.load()
  if (known()) openStory(storyId)
}

const openContacts = () => switchSection('contacts')

/** Закрывает открытую переписку (на мобильном список и нить — один экран). */
const closeOpenChat = () => {
  selectedChatId.value = null
  messages.value = []
  pinnedMessages.value = []
  syncChatUrl(null)
}

/** Переключение между списками в шапке — всегда прямой переход. */
const switchSection = (section: Section) => {
  if (twoPane.value) {
    if (view.value === section) return
    view.value = section
  } else {
    // На телефоне разделы (Чаты/Контакты) живут в drawer'е. Если он
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
}

// Любая смена раздела (в т. ч. прямой вызов view.value) сразу запоминается.
watch(view, (section) => storeSection(section))

const goToChats = () => switchSection('chats')

/**
 * С какого экрана открывать настройки.
 *
 * Профиль грузится отдельным чанком (defineAsyncComponent), поэтому в момент
 * первого открытия дочернего компонента ещё нет и вызов метода в него не
 * долетит. Начальный экран передаём пропом — его компонент читает при
 * монтировании; для уже открытого профиля тот же переход делается методом.
 */
const profileStartSection = ref<'root' | 'admin'>('root')

/**
 * Заголовок окна настроек: у админского экрана он свой — «Администрирование».
 *
 * Своя шапка внутри админского экрана не рисуется (иначе два заголовка подряд),
 * поэтому название даёт само окно. Разделы, открытые ИЗ админского экрана
 * (например «Приглашения»), остаются под этим же заголовком.
 */
const profileTitle = computed(() =>
  profileStartSection.value === 'admin' ? 'Администрирование' : 'Настройки'
)

const goToProfile = () => {
  // Профиль всегда открывается списком разделов — если в прошлый раз был
  // открыт конкретный раздел, возвращаемся к списку.
  profileStartSection.value = 'root'
  profileRef.value?.backToSections()
  pushMobileNav()
  showProfileModal.value = true
}

/** Админская «шестерёнка» внизу списка чатов: служебные разделы и жалобы. */
const goToAdmin = () => {
  profileStartSection.value = 'admin'
  pushMobileNav()
  showProfileModal.value = true
  void nextTick(() => profileRef.value?.openAdmin())
}

/** «Жалобы» из админского экрана: закрываем настройки и открываем разбор. */
const openModerationFromAdmin = () => {
  showProfileModal.value = false
  void nextTick(() => moderationOverlaysRef.value?.openReports())
}

/** Закрытие профиля: сбрасываем раздел (следующее открытие — со списка). */
const onProfileHidden = () => {
  showProfileModal.value = false
  profileRef.value?.backToSections()
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

// ---------- Звонки: экран ожидания, «будильник», кнопки push ----------
// Обвязка интерфейса со стором звонков живёт в composables/useCallSession.ts:
// экран «Входящий звонок…» до доставки паркованного offer, системное
// уведомление при свёрнутом приложении и действия кнопок push.
const {
  callLaunchScreen,
  callLaunchAnswering,
  callLaunchPeerName,
  beginCallLaunch,
  applyCallLaunch,
  answerCallLaunch,
  dismissCallLaunch,
  stopCallLaunchScreen,
  onCallCancelled,
  syncCallRings,
  handleCallVisibility
} = useCallSession({ ready, findPeerUser })
/**
 * Чат, который нужно открыть после входа (запуск из уведомления при истёкшей
 * сессии). Живёт только в памяти страницы: между запусками чат не помним —
 * приложение всегда открывается на главной.
 */
let pendingChatAfterLogin: number | null = null

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
// Приём содержимого, превью и отправка — в composables/useNativeShare.ts.
// Источников два: событие `pismo:share` из Android-оболочки и параметры
// share_target у установленной PWA. Лента отдаёт только отправку.
const {
  descriptor: nativeShare,
  previewUrl: nativeSharePreviewUrl,
  busy: nativeShareBusy,
  releasePending: releaseIncomingShare,
  cancel: cancelNativeShare,
  send: sendIncomingShare
} = useNativeShare({
  isAuthenticated: () => authStore.isAuthenticated,
  chats: () => chats.value,
  currentUserId: () => currentUserId.value,
  selectedChatId: () => selectedChatId.value,
  refreshChats: () => loadChats(),
  refreshThread: () => refreshThread(),
  sendText: async (chatId, text) => {
    const wire = await encryptSharedText(chatId, text)
    await sendNewMessage(chatId, wire.text, undefined, wire.encrypted)
  },
  sendFile: async (chatId, file, caption) => {
    // Фото сжимаем на клиенте — как при обычной отправке вложения.
    const upload = file.type.startsWith('image/') ? await optimizeImageFile(file) : file
    const aes = await chatKeyOf(chats.value.find((item) => item.id === chatId) ?? null)
    const payload = aes ? await encryptFileForChat(aes, upload, caption) : null
    const message = await sendAttachmentMessage(
      chatId,
      payload ? payload.blob : upload,
      payload ? payload.text : caption,
      undefined,
      undefined,
      !!payload
    )
    if (payload) applyLocalFileEnvelope(message, payload.meta)
  }
})

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
      openChannelLink()
      await resolveInviteLink()
      await releaseIncomingShare()
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
    // Отказ из уведомления не выполняем (см. `handleWindowMessage`): на Android
    // кнопка приходит как соседнее действие, и «отказ» на деле означал «хочу
    // ответить». Показываем экран звонка.
    const action = data.action === 'answer' ? 'answer' : 'focus'
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
  moderationOverlaysRef.value?.openReport({
    userId: peer.id,
    userName: displayName(peer),
    chatId: chat.id
  })
}

/** Жалоба на конкретное сообщение (из действий сообщения, работает и в группах). */
const openReportForMessage = (message: Message) => {
  const chat = selectedChat.value
  if (!chat || message.user_id === currentUserId.value) return
  const author = chat.users.find((item) => item.id === message.user_id)
  moderationOverlaysRef.value?.openReport({
    userId: message.user_id,
    userName: author ? displayName(author) : 'Пользователь',
    chatId: chat.id,
    messageId: message.id,
    messagePreview: (message.text ?? '').trim().slice(0, 80)
  })
}

// ---------- Блокировка собеседника открытого чата ----------
// Два вида: полная (переписка и звонки запрещены, чат скрыт) и мягкая — «только
// звонки» (переписка и чат остаются). Состояние читаем с сервера: без этого
// подписи в меню («Заблокировать»/«Разблокировать», «Не принимать звонки» /
// «Принимать звонки») врали бы после перезагрузки страницы.
//
// Вся тема живёт в `usePeerBlocking` — мессенджер только связывает её с шапкой
// чата и списком диалогов. Зависимости отдаём геттерами: `chatPeer`-состояние и
// список чатов меняются, а `refreshChatsQuiet` объявлен выше, но вызывается
// позже — так у composable нет доступа к реактивности мессенджера напрямую.
const {
  peerFullyBlocked,
  peerCallsBlocked,
  blockSelectedPeer,
  toggleSelectedPeerCalls,
  onBlockedUsersChanged
} = usePeerBlocking({
  selectedChat: () => selectedChat.value,
  selectedChatId: () => selectedChatId.value,
  currentUserId: () => currentUserId.value,
  dropChat: (chatId: number) => {
    chats.value = chats.value.filter((item) => item.id !== chatId)
    selectedChatId.value = null
    syncChatUrl(null)
    messages.value = []
  },
  refreshChats: () => refreshChatsQuiet()
})

/**
 * Кто сменил ключ шифрования — имя для предупреждения (ищем в чатах и контактах).
 */
const peerKeyNameFor = (userId: number): string => {
  const peer = findPeerUser(userId)
  return peer ? displayName(peer) : ''
}

/** Отписка от события E2EE (снимается при уходе с экрана). */
let unsubscribePeerKey: (() => void) | null = null

onMounted(async () => {
  await authStore.initializeApp()
  // Истории грузим сразу: точка «есть новое» должна быть видна без захода в раздел.
  if (authStore.isAuthenticated) void storiesStore.load()
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('message', handleWindowMessage)
  window.addEventListener('visibilitychange', handleCallVisibility)
  window.addEventListener('visibilitychange', handleVisibilityForDrafts)
  window.addEventListener('visibilitychange', handleVisibilityForPresence)
  window.addEventListener('visibilitychange', handleVisibilityForUnread)
  window.addEventListener('popstate', onAppPopState)
  // Связь вернулась — досылаем то, что застряло без сети.
  window.addEventListener(ONLINE_RESTORED_EVENT, onConnectionRestored)
  // Собеседник сменил ключ шифрования — предупреждаем один раз на каждый ключ.
  unsubscribePeerKey = onPeerKeyChanged((change) => {
    accountOverlaysRef.value?.openPeerKeyChanged(change)
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
    const launchAction = actionParam === 'answer' ? 'answer' : 'focus'
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

  // Холодный старт по push о реакции на историю: открываем просмотрщик.
  const storyParam = launchParams.get('story')
  if (storyParam && /^\d+$/.test(storyParam)) {
    void openStoryFromPush(Number(storyParam))
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
  if (isPhone.value) drawerOpen.value = false
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
    /** История из push о реакции на неё. */
    story_id?: number | null
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
  if (data.type === 'open-story' && typeof data.story_id === 'number') {
    // Тап по уведомлению о реакции: показываем автору его историю со счётчиками.
    void openStoryFromPush(data.story_id)
    return
  }
  if (data.type === 'call-cancelled') {
    // Звонок завершился там, где мы его не видели (приняли на другом устройстве,
    // отклонили, зовущий снял вызов), а сигнальный канал у нас в этот момент не
    // работал. Гасим экран ожидания и «звонит», если это наш вызов — но НЕ
    // трогаем идущий разговор.
    const finishedId = String(data.call_id ?? '')
    onCallCancelled(finishedId)
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
    accountOverlaysRef.value?.openSecurityAlert()
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
      // «Отклонить» из уведомления (старые уведомления, ссылка из буфера) НЕ
      // выполняем: на Android нажатие кнопки приходит как СОСЕДНЕЕ действие, и
      // «Ответить» могло прийти как «Отклонить» — звонок обрывался у обоих.
      // Показываем экран звонка: отказать можно на нём или смахиванием push.
      if (callId && Number.isFinite(peerId) && peerId > 0) {
        beginCallLaunch(callId, peerId, 'focus')
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
  window.removeEventListener('visibilitychange', handleVisibilityForUnread)
  window.removeEventListener('popstate', onAppPopState)
  window.removeEventListener(ONLINE_RESTORED_EVENT, onConnectionRestored)
  unsubscribePeerKey?.()
  unsubscribePeerKey = null
  disposeNativePush()
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
    accountOverlaysRef.value?.setLoginVisible(!isAuthenticated)
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

// ---------- Входящий звонок при свёрнутом приложении и кнопки push ----------
// Системный «будильник» (показывается один раз на звонок), сброс состояния
// «звонит» при возврате в приложение, действия кнопок уведомления и обогащение
// карточки собеседника живут в composables/useCallSession.ts вместе с watcher'ами.

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

/* Широкий экран с открытой информацией о чате: чат и правая панель — рядом
   (на узких экранах панель не открывается, поэтому класс не срабатывает). */
.messenger-page.has-rail {
  flex-direction: row;
}

/* Правая панель: карточка информации растянута на высоту колонки, прокрутка —
   внутри неё (см. ChatInfo.vue/GroupChatInfo.vue, режим `panel`). */
.chat-rail {
  width: 340px;
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--ms-border);
  background: var(--ms-surface);
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

/* Мобильные настройки — во весь экран. У Quasar-«maximized» селектор
   `.q-dialog__inner--maximized > div` (класс + элемент) слабее нашего
   `.ms-modal[data-v-…]` (класс + scope-атрибут), поэтому ширину и отступы
   перебиваем здесь, а не надеемся на диалог. Прокрутка — ОДНА, общий
   `.ms-modal-body`: карточка не скроллится (flex-колонка), тело растягивается. */
.ms-modal-full {
  width: 100%;
  max-width: 100%;
  height: 100%;
  border: 0;
  display: flex;
  flex-direction: column;
}

/* Вырез экрана (чёлку) учитываем: полноэкранный диалог начинается от самого
   верха окна, а не от безопасной зоны. */
.ms-modal-full .ms-modal-head {
  padding: calc(8px + env(safe-area-inset-top)) 8px 8px 16px;
}

.ms-modal-full .ms-modal-body {
  flex: 1;
  max-height: none;
  padding: 4px 16px calc(24px + env(safe-area-inset-bottom));
}

/* Модалка удаления чата переехала в MessengerChatOverlays.vue вместе с разметкой. */

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

/* Канал: подписчику писать нельзя — вместо композера предложка поста. */
.channel-write-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #ffffff);
}

.channel-write-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--ms-muted, #7b8a96);
  font-size: 12.5px;
}

/* «Предложить пост»: карточка диалога переехала в MessengerChannelOverlays.vue. */

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
