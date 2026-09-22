<template>
  <!-- Создание канала -->
  <q-dialog v-model="showCreateChannelModal">
    <ChannelCreateDialog @close="showCreateChannelModal = false" @created="onCreated" />
  </q-dialog>

  <!-- Подписка на канал по ссылке `/c/<адрес>` -->
  <q-dialog v-model="channelJoinOpen">
    <ChannelJoinDialog
      v-if="channelJoinUsername"
      :username="channelJoinUsername"
      :open="channelJoinOpen"
      @joined="onJoined"
      @left="channelJoinUsername = null"
    />
  </q-dialog>

  <!-- Комментарии к посту канала.
       Как в Telegram: на телефоне это ОТДЕЛЬНЫЙ ЭКРАН (maximized), а не
       маленькое окошко поверх ленты — так видно и пост, и обсуждение. -->
  <q-dialog v-model="channelCommentsOpen" :maximized="!isDesktop">
    <ChannelCommentsDialog
      v-if="channelCommentsFor && props.chatId !== null"
      :chat-id="props.chatId"
      :message-id="channelCommentsFor.id"
      :post-author="channelPostAuthor"
      :post-preview="channelCommentsFor.text"
      :can-comment="true"
      :fullscreen="!isDesktop"
      :open="channelCommentsOpen"
      @count="onCommentsCount"
    />
  </q-dialog>

  <!-- Настройки канала: название, подписчики, предложки -->
  <q-dialog v-model="showChannelInfoModal">
    <ChannelInfoDialog
      v-if="props.chat && props.chat.is_channel"
      :chat-id="props.chat.id"
      :role="props.chat.my_role ?? 'member'"
      :open="showChannelInfoModal"
      @updated="emit('updated')"
      @left="emit('left')"
    />
  </q-dialog>

  <!-- Предложить пост в канал (подписчик) -->
  <q-dialog v-model="channelSuggestOpen">
    <q-card class="ch-suggest-card">
      <q-card-section class="row no-wrap items-center ch-suggest-head">
        <div class="text-subtitle1 text-weight-medium ellipsis">{{ t('Предложить пост') }}</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup :aria-label="t('Закрыть')" />
      </q-card-section>
      <q-separator />
      <q-card-section>
        <textarea
          v-model="channelSuggestText"
          class="ch-suggest-input"
          rows="4"
          maxlength="2000"
          :placeholder="t('Текст поста — его увидит владелец канала')"
        ></textarea>
        <p class="ch-suggest-hint">
          {{ t('Публикуют владелец и админы: они увидят предложку в настройках канала.') }}
        </p>
      </q-card-section>
      <q-separator />
      <q-card-actions align="right">
        <q-btn flat :label="t('Отмена')" v-close-popup />
        <q-btn
          unelevated
          color="primary"
          :label="t('Отправить')"
          :loading="channelSuggestBusy"
          :disable="!channelSuggestText.trim()"
          @click="submitChannelSuggestion"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Оверлеи каналов: создание, подписка по ссылке `/c/<адрес>`, комментарии к
 * посту, настройки и «предложить пост».
 *
 * Состояние открытых диалогов живёт здесь, а данные и последствия — в
 * представлении: оно владеет списком чатов, лентой и адресом. Наружу отдаём
 * методы `open*`/`closeAll`, внутрь принимаем открытый чат и список чатов
 * (по нему находим имя автора поста в шапке комментариев).
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import { Notify, useQuasar } from 'quasar'
import { useMobileLayer } from '@/composables/useMobileOverlay'
import { suggestPost } from '@/services/channelService'
import { getErrorMessage } from '@/services/errors'
import { displayName } from '@/utils/user'
import type { ChannelCard, Chat, Message } from '@/types'
import { t } from '@/i18n'

// Диалоги грузим отдельными чанками: они нужны только работающим с каналами.
const ChannelCreateDialog = defineAsyncComponent(
  () => import('@/components/channels/ChannelCreateDialog.vue')
)
const ChannelJoinDialog = defineAsyncComponent(
  () => import('@/components/channels/ChannelJoinDialog.vue')
)
const ChannelCommentsDialog = defineAsyncComponent(
  () => import('@/components/channels/ChannelCommentsDialog.vue')
)
const ChannelInfoDialog = defineAsyncComponent(
  () => import('@/components/channels/ChannelInfoDialog.vue')
)

const props = defineProps<{
  /** Открытый чат (нужен для настроек: id и моя роль в нём). */
  chat: Chat | null
  /** Id открытого чата — для диалога комментариев. */
  chatId: number | null
  /** Список чатов: по нему находим автора поста для шапки комментариев. */
  chats: Chat[]
}>()

const emit = defineEmits<{
  /** Канал создан из диалога «Новый канал». */
  created: [channel: ChannelCard]
  /** Подписка по ссылке `/c/<адрес>` удалась. */
  joined: [channel: ChannelCard]
  /** Настройки канала изменились. */
  updated: []
  /** Канал покинут или удалён. */
  left: []
  /** Под постом стало другое число комментариев. */
  commentsCount: [payload: { messageId: number; count: number }]
}>()

// Каналы: создание, карточка настроек, комментарии к посту, «предложить пост».
const $q = useQuasar()
/**
 * Десктопный режим (≥1024px) — тот же порог, что у двухпанельного списка.
 * На телефоне и планшете комментарии открываются отдельным экраном.
 */
const isDesktop = computed<boolean>(() => $q.screen.gt.sm)
const showCreateChannelModal = ref(false)
const showChannelInfoModal = ref(false)
const channelCommentsFor = ref<Message | null>(null)
/** Адрес канала из ссылки `/c/<адрес>` — пока не null, показываем экран подписки. */
const channelJoinUsername = ref<string | null>(null)
const channelSuggestOpen = ref(false)
const channelSuggestText = ref('')
const channelSuggestBusy = ref(false)

/**
 * Открыт экран подписки на канал (адрес из ссылки).
 *
 * Computed ЗАПИСЫВАЕМЫЙ, и это не придирка: `q-dialog` закрывается, только
 * эмитя `update:modelValue = false`. У readonly-computed запись отбрасывается
 * (Vue пишет «Write operation failed» в консоль, а окно остаётся открытым) —
 * так и выглядел баг «окно комментариев нельзя закрыть»: ни крестик, ни Esc, ни
 * клик мимо не работали.
 */
const channelJoinOpen = computed<boolean>({
  get: () => channelJoinUsername.value !== null,
  set: (open) => {
    if (!open) channelJoinUsername.value = null
  }
})

/** Открыт диалог комментариев к посту (тоже записываемый — см. выше). */
const channelCommentsOpen = computed<boolean>({
  get: () => channelCommentsFor.value !== null,
  set: (open) => {
    if (!open) channelCommentsFor.value = null
  }
})

/** Автор поста, который комментируют (имя для шапки диалога). */
const channelPostAuthor = computed<string | undefined>(() => {
  const message = channelCommentsFor.value
  if (!message) return undefined
  const chat = props.chats.find((item) => item.id === message.chat_id)
  const author = chat?.users.find((user) => user.id === message.user_id)
  return author ? displayName(author) : undefined
})

const onCreated = (channel: ChannelCard) => {
  showCreateChannelModal.value = false
  emit('created', channel)
}

const onJoined = (channel: ChannelCard) => {
  channelJoinUsername.value = null
  emit('joined', channel)
}

/** Диалог комментариев сообщил новое число комментариев под постом. */
const onCommentsCount = (payload: { messageId: number; count: number }) => {
  emit('commentsCount', payload)
}

/** «Предложить пост»: подписчик отправляет текст на одобрение админам. */
const submitChannelSuggestion = async () => {
  const chatId = props.chatId
  const text = channelSuggestText.value.trim()
  if (chatId === null || !text || channelSuggestBusy.value) return
  channelSuggestBusy.value = true
  try {
    await suggestPost(chatId, text)
    channelSuggestOpen.value = false
    channelSuggestText.value = ''
  } catch (error) {
    Notify.create({ type: 'negative', message: getErrorMessage(error), timeout: 4000 })
  } finally {
    channelSuggestBusy.value = false
  }
}

/** Открыть диалог «Новый канал» (меню «⋯» в списке чатов). */
const openCreate = () => {
  showCreateChannelModal.value = true
}

/** Открыть экран подписки по адресу канала из ссылки `/c/<адрес>`. */
const openJoin = (username: string) => {
  channelJoinUsername.value = username
}

/** Открыть комментарии к посту. */
const openComments = (message: Message) => {
  channelCommentsFor.value = message
}

/** Открыть настройки канала. */
const openInfo = () => {
  showChannelInfoModal.value = true
}

/** Открыть «Предложить пост». */
const openSuggest = () => {
  channelSuggestOpen.value = true
}

/** Закрыть всё канальное (сменился открытый чат) — без событий наружу. */
const closeAll = () => {
  showChannelInfoModal.value = false
  channelCommentsFor.value = null
}

// Каждый диалог канала — свой слой: и «назад» его закрывает по одному, и шаг в
// истории ставится/гасится автоматически (см. `useMobileOverlay`). Раньше
// маркер ставило представление при открытии, а закрытие крестиком его не гасило:
// следующее «назад» закрывало уже чат под диалогом.
useMobileLayer(
  () => showCreateChannelModal.value,
  () => {
    showCreateChannelModal.value = false
  }
)
useMobileLayer(
  () => channelJoinUsername.value !== null,
  () => {
    channelJoinUsername.value = null
  }
)
useMobileLayer(
  () => channelCommentsFor.value !== null,
  () => {
    channelCommentsFor.value = null
  }
)
useMobileLayer(
  () => showChannelInfoModal.value,
  () => {
    showChannelInfoModal.value = false
  }
)
useMobileLayer(
  () => channelSuggestOpen.value,
  () => {
    channelSuggestOpen.value = false
  }
)

defineExpose({
  openCreate,
  openJoin,
  openComments,
  openInfo,
  openSuggest,
  closeAll
})
</script>

<style scoped>
/* «Предложить пост»: карточка диалога в стиле остальных модалок. */
.ch-suggest-card {
  width: min(460px, 92vw);
  border-radius: 16px;
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #141d26);
}

.ch-suggest-head {
  padding: 12px 14px;
}

.ch-suggest-input {
  width: 100%;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 11px;
  background: var(--ms-surface-2, #f6f8fa);
  color: var(--ms-text, #1c2733);
  padding: 9px 12px;
  font-family: var(--ms-font), sans-serif;
  font-size: 14px;
  line-height: 1.35;
  resize: none;
}

.ch-suggest-input:focus {
  outline: none;
  border-color: var(--ms-accent, #2ea25e);
}

.ch-suggest-hint {
  margin: 8px 0 0;
  color: var(--ms-muted, #7b8a96);
  font-size: 12px;
  line-height: 1.35;
}
</style>
