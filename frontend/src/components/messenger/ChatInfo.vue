<template>
  <q-card class="chatinfo-card" :class="{ 'is-panel': panel }">
    <q-card-section class="row no-wrap items-center chatinfo-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">{{ t('Информация о чате') }}</div>
      <q-space />
      <!-- В панели (широкий экран) «закрыть» — просто событие: закрывать
           q-popup там нечего, диалога нет. -->
      <q-btn
        v-if="panel"
        flat
        round
        dense
        icon="close"
        :aria-label="t('Закрыть')"
        @click="emit('close')"
      />
      <q-btn v-else flat round dense icon="close" v-close-popup :aria-label="t('Закрыть')" />
    </q-card-section>
    <q-separator />
    <q-card-section class="chatinfo-body">
      <template v-if="peer">
        <div class="ci-hero">
          <span class="ci-avatar" :style="avatarStyle(peerName)">
            <img
              v-if="peerAvatar"
              :src="peerAvatar"
              class="ci-avatar-img"
              alt=""
              decoding="async"
            />
            <template v-else>{{ initials(peerName) }}</template>
          </span>
          <div class="ci-hero-name">{{ peerName }}</div>
          <div v-if="peer.username" class="ci-hero-sub">@{{ peer.username }}</div>
          <div v-if="peer.phone_number" class="ci-hero-sub ci-phone">
            <q-icon :name="icon('call')" size="13px" /> {{ peer.phone_number }}
          </div>
          <div v-if="peer.status" class="ci-status">{{ peer.status }}</div>
          <div class="ci-presence">{{ subtitle }}</div>
        </div>
      </template>

      <!-- Личное имя контакта: видит только владелец (как в Telegram).
           В «Сохранённых сообщениях» собеседник — сам человек, добавлять себя в
           контакты нечего (и переименовывать тоже). -->
      <div v-if="peer && !isSelfChat" class="ci-section ci-e2ee">
        <div class="ci-e2ee-row">
          <div class="ci-e2ee-info">
            <div class="ci-e2ee-title">{{ t('Контакт') }}</div>
            <div class="ci-e2ee-desc">
              {{
                contactName
                  ? t('В ваших контактах: {name}', { name: contactName })
                  : t('Добавьте в контакты и назовите по-своему — имя видите только вы.')
              }}
            </div>
          </div>
          <q-btn
            flat
            no-caps
            dense
            color="primary"
            :label="contactName ? t('Переименовать') : t('В контакты')"
            @click="contactDialogOpen = true"
          />
        </div>
      </div>

      <!-- Тип чата: обычный / зашифрованный (E2EE).
           У «Сохранённых сообщений» переключателя нет: сервер отклоняет такой
           чат (`api_v1/chats/crud.py::set_chat_e2ee` — 400 на `chat.is_self`),
           то есть кнопка вела в ошибку. -->
      <div v-if="peer && !isSelfChat" class="ci-section ci-e2ee">
        <div class="ci-e2ee-row">
          <div class="ci-e2ee-info">
            <div class="ci-e2ee-title">{{ t('Сквозное шифрование') }}</div>
            <div class="ci-e2ee-desc">
              {{
                t(
                  'Обычный чат — текст виден в превью и уведомлениях. Зашифрованный — сообщения читают только участники, но текст скрыт в превью/уведомлениях.'
                )
              }}
            </div>
          </div>
          <q-toggle
            :model-value="e2eeEnabled"
            color="primary"
            keep-color
            :disable="e2eeBusy"
            :aria-label="t('Сквозное шифрование')"
            @update:model-value="onToggleE2ee"
          />
        </div>
        <!-- Проверка ключей: показывает одинаковый у обоих участников код. Так
             проверяемое утверждение «сервер не читает» можно подтвердить лично. -->
        <button v-if="e2eeEnabled" class="ci-verify" type="button" @click="safetyOpen = true">
          <q-icon :name="icon('verified_user')" size="18px" />
          <span>{{ t('Проверить шифрование') }}</span>
        </button>
      </div>

      <div v-if="images.length || mediaHasMore" class="ci-section">
        <h4 class="ci-title">{{ t('Изображения') }}</h4>
        <div v-if="images.length" class="ci-grid">
          <button
            v-for="image in images"
            :key="image.id"
            class="ci-thumb"
            :title="image.name"
            @click="emit('open-image', image.id)"
          >
            <img :src="image.url" :alt="image.name" loading="lazy" decoding="async" />
          </button>
        </div>
        <div v-else class="ci-empty">{{ t('Изображений пока нет') }}</div>
      </div>

      <div v-if="files.length || mediaHasMore" class="ci-section">
        <h4 class="ci-title">{{ t('Файлы') }}</h4>
        <a
          v-for="file in files"
          :key="file.id"
          class="ci-file"
          :href="file.url"
          target="_blank"
          rel="noopener"
        >
          <q-icon :name="icon(file.icon)" size="22px" />
          <span class="ci-file-info">
            <span class="ci-file-name">{{ file.name }}</span>
            <span class="ci-file-meta">{{ file.meta }}</span>
          </span>
        </a>
        <div v-if="!files.length" class="ci-empty">{{ t('Файлов пока нет') }}</div>
      </div>

      <!-- Галерея показывает вложения всей истории, а не только загруженные
           сообщения: лента подгружается страницами по ~100 штук. -->
      <div v-if="mediaHasMore" class="ci-more">
        <q-btn
          flat
          no-caps
          dense
          color="primary"
          :loading="mediaLoading"
          :label="t('Показать ещё')"
          @click="loadMoreMedia"
        />
      </div>
      <div v-if="mediaError" class="ci-error">{{ mediaError }}</div>
      <div v-if="mediaLocalOnly" class="ci-hint">
        {{ t('Чат зашифрован — показаны загруженные вложения.') }}
      </div>

      <div v-if="!images.length && !files.length && !mediaHasMore" class="ci-empty">
        {{ t('В этом чате пока нет общих вложений') }}
      </div>
    </q-card-section>

    <!-- Диалог «Добавить в контакты / Имя контакта» -->
    <ContactNameDialog v-if="peer && !isSelfChat" v-model="contactDialogOpen" :user="peer" />

    <!-- Сверка ключей шифрования (safety number) -->
    <SafetyNumberDialog
      v-if="safetyOpen && peer"
      :my-user-id="currentUserId"
      :peer-id="peer.id"
      :peer-name="chatPeerTitle(chat, currentUserId)"
      @close="safetyOpen = false"
    />
  </q-card>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, onMounted, ref, watch } from 'vue'
import type { Chat, ChatMediaItem, ChatUser, Message } from '@/types'
import { mediaUrl } from '@/config'
import { fetchChatMedia } from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'
import ContactNameDialog from '@/components/messenger/ContactNameDialog.vue'
import SafetyNumberDialog from '@/components/messenger/SafetyNumberDialog.vue'
import { useMobileLayer } from '@/composables/useMobileOverlay'
import { useContactsStore } from '@/stores/contacts'
import {
  avatarStyle,
  avatarUrlOf,
  chatPeer,
  chatPeerTitle,
  initials,
  savedMessagesTitle
} from '@/utils/user'
import { formatBytes, formatMsgTime } from '@/utils/format'
import { fileIcon, mediaKindOf } from '@/utils/media'
import { t } from '@/i18n'

const props = defineProps<{
  chat: Chat
  currentUserId: number | null
  /** Подпись присутствия («в сети»/«был(а) …») — вычисляется родителем. */
  subtitle: string
  /** Сообщения открытого треда (для списка общих медиа). */
  messages: Message[]
  /** Включено ли сквозное шифрование (тип чата «зашифрованный»). */
  e2eeEnabled?: boolean
  /** Идёт ли сохранение переключения типа чата. */
  e2eeBusy?: boolean
  /**
   * Режим правой панели (широкий экран): та же карточка, но без рамки, на всю
   * высоту колонки и с прокруткой внутри. Разметка и логика те же, поэтому
   * информация не расходится между модалкой и панелью.
   */
  panel?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-image', messageId: number): void
  (e: 'toggle-e2ee', enabled: boolean): void
}>()

/** Переключатель «Сквозное шифрование» в карточке чата. */
const onToggleE2ee = (val: boolean | string | null) => {
  emit('toggle-e2ee', val === true || val === 'true')
}

/** Открыт экран сверки ключей (safety number). */
const safetyOpen = ref(false)
const peer = computed<ChatUser | undefined>(() => chatPeer(props.chat, props.currentUserId))

/**
 * «Сохранённые сообщения» — чат с собой.
 *
 * ГРАБЛЯ (поймал пользователь 15.09.2026): `chatPeer` для такого чата отдаёт
 * САМОГО человека (фоллбэк `chat.users[0]`), и карточка предлагала «В контакты»
 * с переименованием себя же, а тумблер «Сквозное шифрование» отправлял запрос,
 * который сервер отклоняет. У собеседника-себя нет ничего, чем можно управлять.
 */
const isSelfChat = computed<boolean>(() => props.chat.is_self === true)

/** Личное имя собеседника (пусто — не добавлен в контакты / не назван). */
const contactsStore = useContactsStore()
const contactDialogOpen = ref(false)

// Диалоги внутри карточки чата (переименование контакта, номер безопасности) —
// слои: «назад» закрывает верхний из них, а не всю карточку вместе с чатом
// (см. `useMobileOverlay`).
useMobileLayer(
  () => contactDialogOpen.value,
  () => {
    contactDialogOpen.value = false
  }
)
useMobileLayer(
  () => safetyOpen.value,
  () => {
    safetyOpen.value = false
  }
)
const contactName = computed<string>(() => (peer.value ? contactsStore.nameOf(peer.value.id) : ''))

const peerName = computed<string>(() => {
  // Чат с собой: серверное имя русское, показываем перевод.
  const value = props.chat.is_self
    ? savedMessagesTitle(props.chat.name)
    : props.chat.users.length === 2
      ? chatPeerTitle(props.chat, props.currentUserId)
      : props.chat.name
  return value || t('Чат')
})
const peerAvatar = computed<string | undefined>(() => avatarUrlOf(peer.value))

/** Изображения/гифки чата (в порядке «от новых к старым»). */
const images = computed(() =>
  mediaItems.value
    .filter((item) => item.kind === 'image')
    .map((item) => ({ id: item.id, url: mediaUrl(item.url), name: item.name }))
)

/** Прочие вложения (видео/аудио/документы). */
const files = computed(() =>
  mediaItems.value
    .filter((item) => item.kind !== 'image')
    .map((item) => ({
      id: item.id,
      url: mediaUrl(item.url),
      name: item.name,
      icon: fileIcon({ name: item.name, url: item.url, mime: item.mime, size: item.size }),
      meta: `${formatBytes(item.size)} · ${formatMsgTime(item.timestamp)}`
    }))
)

// ---------- Галерея медиа ----------
/**
 * Сколько вложений запрашиваем за раз. Лента отдаёт историю страницами по ~100
 * сообщений, поэтому галерея «из ленты» показывала только свежую часть чата —
 * здесь вложения выбирает сервер (`/messages/{id}/media/`), и видна вся история.
 */
const MEDIA_PAGE_SIZE = 60

/** Вложения из ответа сервера (обычный чат). */
const serverMedia = ref<ChatMediaItem[]>([])
const mediaLoading = ref(false)
const mediaHasMore = ref(false)
const mediaError = ref('')

/**
 * Зашифрованный чат: сервер содержимое вложений не читает (ключ чата у клиента),
 * поэтому галерея строится из уже расшифрованной ленты.
 */
const mediaLocalOnly = computed<boolean>(() => props.e2eeEnabled === true)

/** Вложения из загруженной ленты — фолбэк для зашифрованного чата. */
const localMedia = computed<ChatMediaItem[]>(() =>
  props.messages
    .filter((message) => message.file !== null)
    .map((message) => ({
      id: message.id,
      timestamp: message.timestamp,
      url: message.file!.url,
      name: message.file!.name || t('Файл'),
      mime: message.file!.mime,
      size: message.file!.size,
      kind: mediaKindOf({ mime: message.file!.mime, name: message.file!.name })
    }))
)

const mediaItems = computed<ChatMediaItem[]>(() =>
  mediaLocalOnly.value ? localMedia.value : serverMedia.value
)

/** Загружает страницу вложений: сначала свежие, затем — более старые. */
const loadMedia = async (reset: boolean) => {
  if (mediaLocalOnly.value || mediaLoading.value) return
  if (reset) {
    serverMedia.value = []
    mediaError.value = ''
  }
  mediaLoading.value = true
  try {
    const last = serverMedia.value[serverMedia.value.length - 1]
    const oldestId = last?.id
    const page = await fetchChatMedia(props.chat.id, {
      limit: MEDIA_PAGE_SIZE,
      ...(oldestId !== undefined ? { beforeId: oldestId } : {})
    })
    const known = new Set(serverMedia.value.map((item) => item.id))
    serverMedia.value = [...serverMedia.value, ...page.filter((item) => !known.has(item.id))]
    mediaHasMore.value = page.length === MEDIA_PAGE_SIZE
  } catch (error) {
    mediaError.value = getErrorMessage(error, t('Не удалось загрузить вложения'))
    mediaHasMore.value = false
  } finally {
    mediaLoading.value = false
  }
}

const loadMoreMedia = () => void loadMedia(false)

onMounted(() => void loadMedia(true))

// Смена чата или включение шифрования — другая история вложений.
watch(
  () => [props.chat.id, props.e2eeEnabled],
  () => void loadMedia(true)
)
</script>

<style scoped>
.chatinfo-card {
  width: min(420px, calc(100vw - 32px));
  border-radius: 18px;
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #141d26);
}

.chatinfo-head {
  padding: 8px 12px 8px 18px;
}

.chatinfo-body {
  padding: 6px 18px 20px;
  max-height: 80vh;
  overflow-y: auto;
}

/* Режим правой панели (≥1280px): карточка растягивается на высоту колонки,
   прокручивается только тело — как у модалки, но без «карточных» границ. */
.chatinfo-card.is-panel {
  width: 100%;
  height: 100%;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chatinfo-card.is-panel .chatinfo-body {
  flex: 1;
  min-height: 0;
  max-height: none;
}

.ci-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 10px 0 6px;
}

.ci-avatar {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  color: var(--ms-on-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 2rem;
  overflow: hidden;
}

.ci-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ci-hero-name {
  margin-top: 10px;
  font-size: 17px;
  font-weight: 700;
  color: var(--ms-text, #141d26);
}

.ci-hero-sub {
  margin-top: 2px;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ci-status {
  margin-top: 8px;
  font-size: 13px;
  color: var(--ms-text, #141d26);
  background: var(--ms-surface-2, #f0f2f5);
  border-radius: 10px;
  padding: 3px 10px;
}

.ci-presence {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--ms-accent, #2ea25e);
}

.ci-section {
  margin-top: 14px;
}

.ci-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ms-muted, #71808d);
}

.ci-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.ci-thumb {
  padding: 0;
  border: none;
  background: var(--ms-surface-2, #f0f2f5);
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 1;
  cursor: zoom-in;
}

.ci-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ci-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 6px;
  border-radius: 10px;
  color: var(--ms-text, #141d26);
  text-decoration: none;
}

.ci-file:hover {
  background: var(--ms-hover, #f2f4f6);
}

.ci-file > .q-icon {
  color: var(--ms-muted-2, #5b6b79);
}

.ci-file-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ci-file-name {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ci-file-meta {
  font-size: 12px;
  color: var(--ms-muted, #71808d);
}

.ci-empty {
  font-size: 13px;
  color: var(--ms-muted, #71808d);
  padding: 10px 0;
  text-align: center;
}

/* Подгрузка галереи «Показать ещё» */
.ci-more {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

.ci-error {
  font-size: 13px;
  color: var(--ms-danger, #c0392b);
  text-align: center;
  padding-top: 6px;
}

.ci-hint {
  font-size: 12px;
  color: var(--ms-muted, #71808d);
  text-align: center;
  padding-top: 6px;
}

/* Тип чата: обычный / зашифрованный (E2EE) */
.ci-e2ee-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--ms-surface-2, #f0f2f5);
  border-radius: 12px;
  padding: 10px 12px;
}

.ci-e2ee-info {
  flex: 1;
  min-width: 0;
}

.ci-e2ee-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text, #141d26);
}

.ci-e2ee-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.35;
  color: var(--ms-muted, #71808d);
}

/* Кнопка проверки ключей: спокойная строка под описанием шифрования. */
.ci-verify {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 6px 10px;
  border: 1px solid var(--ms-border, #dfe4e8);
  border-radius: 10px;
  background: transparent;
  color: var(--ms-accent, #2a5885);
  font-size: 13px;
  cursor: pointer;
}

.ci-verify:hover {
  background: var(--ms-surface-2, #f3f5f7);
}
</style>
