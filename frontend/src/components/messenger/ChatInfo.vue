<template>
  <q-card class="chatinfo-card">
    <q-card-section class="row no-wrap items-center chatinfo-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">Информация о чате</div>
      <q-space />
      <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
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

      <!-- Личное имя контакта: видит только владелец (как в Telegram) -->
      <div v-if="peer" class="ci-section ci-e2ee">
        <div class="ci-e2ee-row">
          <div class="ci-e2ee-info">
            <div class="ci-e2ee-title">Контакт</div>
            <div class="ci-e2ee-desc">
              {{
                contactName
                  ? `В ваших контактах: ${contactName}`
                  : 'Добавьте в контакты и назовите по-своему — имя видите только вы.'
              }}
            </div>
          </div>
          <q-btn
            flat
            no-caps
            dense
            color="primary"
            :label="contactName ? 'Переименовать' : 'В контакты'"
            @click="contactDialogOpen = true"
          />
        </div>
      </div>

      <!-- Тип чата: обычный / зашифрованный (E2EE) -->
      <div v-if="peer" class="ci-section ci-e2ee">
        <div class="ci-e2ee-row">
          <div class="ci-e2ee-info">
            <div class="ci-e2ee-title">Сквозное шифрование</div>
            <div class="ci-e2ee-desc">
              Обычный чат — текст виден в превью и уведомлениях. Зашифрованный — сообщения читают
              только участники, но текст скрыт в превью/уведомлениях.
            </div>
          </div>
          <q-toggle
            :model-value="e2eeEnabled"
            color="primary"
            keep-color
            :disable="e2eeBusy"
            aria-label="Сквозное шифрование"
            @update:model-value="onToggleE2ee"
          />
        </div>
      </div>

      <div v-if="images.length" class="ci-section">
        <h4 class="ci-title">Изображения</h4>
        <div class="ci-grid">
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
      </div>

      <div v-if="files.length" class="ci-section">
        <h4 class="ci-title">Файлы</h4>
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
        <div v-if="!files.length" class="ci-empty">Файлов пока нет</div>
      </div>

      <div v-if="!images.length && !files.length" class="ci-empty">
        В этом чате пока нет общих вложений
      </div>
    </q-card-section>

    <!-- Диалог «Добавить в контакты / Имя контакта» -->
    <ContactNameDialog v-if="peer" v-model="contactDialogOpen" :user="peer" />
  </q-card>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, ref } from 'vue'
import type { Chat, ChatUser, Message } from '@/types'
import { mediaUrl } from '@/config'
import ContactNameDialog from '@/components/messenger/ContactNameDialog.vue'
import { useContactsStore } from '@/stores/contacts'
import { avatarStyle, avatarUrlOf, chatPeer, chatPeerTitle, initials } from '@/utils/user'
import { formatBytes, formatMsgTime } from '@/utils/format'
import { fileIcon, isImageFile } from '@/utils/media'

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

const peer = computed<ChatUser | undefined>(() => chatPeer(props.chat, props.currentUserId))

/** Личное имя собеседника (пусто — не добавлен в контакты / не назван). */
const contactsStore = useContactsStore()
const contactDialogOpen = ref(false)
const contactName = computed<string>(() => (peer.value ? contactsStore.nameOf(peer.value.id) : ''))

const peerName = computed<string>(() => {
  const value =
    props.chat.users.length === 2 ? chatPeerTitle(props.chat, props.currentUserId) : props.chat.name
  return value || 'Чат'
})
const peerAvatar = computed<string | undefined>(() => avatarUrlOf(peer.value))

/** Изображения/гифки из загруженной истории чата. */
const images = computed(() =>
  props.messages
    .filter((m) => m.file !== null && isImageFile(m.file))
    .map((m) => ({ id: m.id, url: mediaUrl(m.file!.url), name: m.file!.name || 'Изображение' }))
)

/** Прочие вложения (видео/аудио/документы). */
const files = computed(() =>
  props.messages
    .filter((m) => m.file !== null && !isImageFile(m.file))
    .map((m) => ({
      id: m.id,
      url: mediaUrl(m.file!.url),
      name: m.file!.name || 'Файл',
      icon: fileIcon(m.file!),
      meta: `${formatBytes(m.file!.size)} · ${formatMsgTime(m.timestamp)}`
    }))
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
</style>
