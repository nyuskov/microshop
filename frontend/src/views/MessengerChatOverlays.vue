<template>
  <!-- Информация о чате -->
  <q-dialog v-model="chatInfo">
    <template v-if="chat && !isGroupChat(chat)">
      <ChatInfo
        :chat="chat"
        :current-user-id="currentUserId"
        :subtitle="subtitle"
        :messages="messages"
        :e2ee-enabled="!!chat.e2ee_enabled"
        @toggle-e2ee="emit('e2eeToggle', $event)"
        @close="chatInfo = false"
        @open-image="emit('openImage', $event)"
      />
    </template>
  </q-dialog>

  <!-- Информация о группе: состав, роли, настройки -->
  <q-dialog v-model="groupInfo">
    <template v-if="chat && isGroupChat(chat)">
      <GroupChatInfo
        :chat="chat"
        :current-user-id="currentUserId"
        :contacts="contacts"
        :online-user-ids="onlineUserIds"
        :e2ee-enabled="!!chat.e2ee_enabled"
        @close="groupInfo = false"
        @updated="emit('groupUpdated')"
        @left="emit('groupLeft')"
        @toggle-e2ee="emit('e2eeToggle', $event)"
        @members-changed="emit('membersChanged', $event)"
      />
    </template>
  </q-dialog>

  <!-- Создание группы -->
  <q-dialog v-model="createGroup">
    <GroupCreateDialog
      :contacts="contacts"
      @close="createGroup = false"
      @created="emit('groupCreated', $event)"
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
        <q-btn flat color="negative" label="Удалить" @click="confirmDelete" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Оверлеи «чат и группа»: информация о чате, карточка группы, создание группы и
 * модалка удаления чата (для себя / для всех).
 *
 * Флаги первых трёх диалогов остаются у представления (`v-model`): они участвуют
 * в шагах системной «назад» (`useChatNavigation.layers`). Удаление чата целиком
 * здесь — оно в этих шагах не участвует, а наружу отдаётся лишь подтверждение.
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import { chatPeer, displayName, isGroupChat } from '@/utils/user'
import type { Chat, ChatUser, Message } from '@/types'

const ChatInfo = defineAsyncComponent(() => import('@/components/messenger/ChatInfo.vue'))
const GroupChatInfo = defineAsyncComponent(() => import('@/components/messenger/GroupChatInfo.vue'))
const GroupCreateDialog = defineAsyncComponent(
  () => import('@/components/messenger/GroupCreateDialog.vue')
)

/** Открыт экран информации о чате (у представления — ради «назад»). */
const chatInfo = defineModel<boolean>('chatInfo', { required: true })
/** Открыта карточка группы (у представления — ради «назад»). */
const groupInfo = defineModel<boolean>('groupInfo', { required: true })
/** Открыт диалог «Новая группа» (у представления — ради «назад»). */
const createGroup = defineModel<boolean>('createGroup', { required: true })

const props = defineProps<{
  /** Открытый чат (личный или группа). */
  chat: Chat | null
  /** Список чатов: по нему считается название удаляемого чата. */
  chats: Chat[]
  /** Мои контакты — для карточки группы и создания группы. */
  contacts: ChatUser[]
  /** Лента открытого чата: «Информация о чате» показывает по ней галерею. */
  messages: Message[]
  /** Кто из собеседников сейчас в сети (точки в карточке группы). */
  onlineUserIds: number[]
  /** Мой id. */
  currentUserId: number | null
  /** Подпись под названием в «Информации о чате» (канал/был(а) недавно). */
  subtitle: string
}>()

const emit = defineEmits<{
  /** Открыть вложение из галереи «Информации о чате». */
  openImage: [messageId: number]
  /** Переключили сквозное шифрование. */
  e2eeToggle: [enabled: boolean]
  /** Название/аватар/состав группы изменились. */
  groupUpdated: []
  /** Группа покинута или удалена. */
  groupLeft: []
  /** Состав группы изменился (нужен пересбор ключа). */
  membersChanged: [rotate: boolean]
  /** Группа создана. */
  groupCreated: [chat: Chat]
  /** Подтвердили удаление: кого и только у меня/у всех. */
  deleteConfirmed: [payload: { ids: number[]; forAll: boolean }]
}>()

// ---------- Модалка «Удалить чат» (для себя / для всех) ----------
const showDeleteChatModal = ref(false)
const deleteChatTarget = ref<Chat | null>(null)
const deleteChatBulkIds = ref<number[]>([])
const deleteChatScope = ref<'me' | 'all'>('me')

/** Название чата для вопроса «Удалить чат с …?». */
const chatDeleteLabel = (chat: Chat): string => {
  const peer = chatPeer(chat, props.currentUserId)
  return chat.users.length === 2 && peer ? displayName(peer) : chat.name
}

const deleteChatTitle = computed<string>(() =>
  deleteChatTarget.value ? chatDeleteLabel(deleteChatTarget.value) : ''
)

/**
 * Открывает модалку удаления одного чата (вместо `window.confirm`).
 *
 * Сегодня в интерфейсе остался только групповой вход — «Удалить выбранные» в
 * режиме выделения (`openBulkDelete`): отдельного пункта «Удалить чат» у строки
 * списка нет, событие `delete-chat` из сайдбара было мёртвым и удалено. Метод
 * оставлен как часть API модалки: вёрстка и текст для одного чата на месте.
 */
const openDelete = (chat: Chat) => {
  if (chat.is_self) return // «Сохранённые сообщения» удалить нельзя
  deleteChatTarget.value = chat
  deleteChatBulkIds.value = []
  deleteChatScope.value = 'me'
  showDeleteChatModal.value = true
}

/** Удаление нескольких выбранных чатов (режим выделения). */
const openBulkDelete = (chatIds: number[]) => {
  const ids = chatIds.filter((id) => !props.chats.find((item) => item.id === id)?.is_self)
  if (ids.length === 0) return
  deleteChatTarget.value = null
  deleteChatBulkIds.value = ids
  deleteChatScope.value = 'me'
  showDeleteChatModal.value = true
}

/** Подтверждение из модалки: удалить «только у меня» или «для всех». */
const confirmDelete = () => {
  const ids = deleteChatBulkIds.value.length
    ? deleteChatBulkIds.value
    : deleteChatTarget.value
      ? [deleteChatTarget.value.id]
      : []
  if (ids.length === 0) return
  const forAll = deleteChatScope.value === 'all'
  showDeleteChatModal.value = false
  deleteChatTarget.value = null
  deleteChatBulkIds.value = []
  emit('deleteConfirmed', { ids, forAll })
}

defineExpose({ openDelete, openBulkDelete })
</script>

<style scoped>
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
</style>
