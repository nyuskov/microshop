<template>
  <div class="stories-strip">
    <!-- Моя история: без своей — сразу выбор файла, со своей — открыть/добавить -->
    <div class="story-cell">
      <button class="story-avatar-btn" type="button" title="Моя история" @click="onMineClick">
        <span
          class="story-avatar"
          :class="{ empty: !mine }"
          :style="mine ? avatarStyle(myName) : undefined"
        >
          <img v-if="myAvatar" :src="myAvatar" alt="" loading="lazy" decoding="async" />
          <template v-else>{{ myInitials }}</template>
        </span>
      </button>
      <button
        v-if="!publishing"
        class="story-add"
        type="button"
        title="Добавить историю"
        @click="pickFile"
      >
        <q-icon :name="icon('add')" size="14px" />
      </button>
      <span v-else class="story-add busy"><span class="mini-spinner"></span></span>
      <span class="story-name">Моя история</span>
    </div>

    <!-- Истории других: точка-кольцо, если есть непросмотренные -->
    <button
      v-for="group in stories.others"
      :key="group.user.id"
      class="story-cell"
      type="button"
      @click="emit('open-story', firstUnseenId(group))"
    >
      <span
        class="story-avatar"
        :class="{ unseen: group.has_unseen }"
        :style="avatarStyle(authorName(group))"
      >
        <img
          v-if="authorAvatar(group)"
          :src="authorAvatar(group)"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <template v-else>{{ authorInitials(group) }}</template>
      </span>
      <span class="story-name">{{ authorName(group) }}</span>
    </button>

    <p v-if="!stories.others.length && !mine" class="story-hint">
      Здесь появятся истории друзей — они живут 24 часа.
    </p>

    <input
      ref="fileInput"
      class="hidden-file"
      type="file"
      accept="image/*,video/*"
      @change="onFileSelected"
    />

    <!-- Подпись к новой истории -->
    <q-dialog v-model="captionOpen">
      <q-card class="story-caption-card">
        <q-card-section>
          <div class="story-caption-title">Новая история</div>
          <p class="story-caption-hint">
            {{ pendingFile?.name }} — можно добавить подпись. История исчезнет через 24 часа.
          </p>
          <input
            v-model="caption"
            class="story-caption-input"
            type="text"
            maxlength="140"
            placeholder="Подпись (необязательно)"
            @keyup.enter="publish"
          />
          <p v-if="stories.error" class="story-caption-error">{{ stories.error }}</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Отмена" @click="cancelPublish" />
          <q-btn
            color="primary"
            unelevated
            label="Опубликовать"
            :loading="publishing"
            @click="publish"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, ref } from 'vue'
import { Notify } from 'quasar'

import { mediaUrl } from '@/config'
import { useAuthStore } from '@/stores/auth'
import { useStoriesStore } from '@/stores/stories'
import type { StoryGroup } from '@/services/stories'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'

const emit = defineEmits<{
  (e: 'open-story', storyId: number): void
}>()

const stories = useStoriesStore()
const authStore = useAuthStore()

const fileInput = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const caption = ref('')
const captionOpen = ref(false)
const publishing = computed(() => stories.publishing)

const mine = computed(() => stories.mine)

const myAvatar = computed(() => {
  const me = authStore.current_user
  const path = me?.avatar_thumb_url || me?.avatar_url
  return path ? mediaUrl(path) : ''
})

const myInitials = computed(() => {
  const user = authStore.current_user
  const name = user ? displayName(user) : ''
  return name ? initials(name) : 'Я'
})

/** Имя для фона аватара-заглушки (чтобы акцентное кольцо было видно). */
const myName = computed(() => {
  const user = authStore.current_user
  return user ? displayName(user) : ''
})

const authorName = (group: StoryGroup) => displayName(group.user) || `@${group.user.username}`

const authorAvatar = (group: StoryGroup) => {
  const path = avatarUrlOf(group.user)
  return path ? mediaUrl(path) : ''
}

const authorInitials = (group: StoryGroup) => initials(authorName(group))

/** Первая непросмотренная история автора (или первая, если всё просмотрено). */
const firstUnseenId = (group: StoryGroup): number => {
  const unseen = group.items.find((item) => !item.viewed)
  return (unseen ?? group.items[0]).id
}

const pickFile = () => fileInput.value?.click()

/** Открыть свою историю (если она уже есть), иначе — выбрать файл. */
const onMineClick = () => {
  const myStory = mine.value?.items[0]
  if (myStory) emit('open-story', myStory.id)
  else pickFile()
}

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    Notify.create({ message: 'История может быть фото или видео', timeout: 3000 })
    return
  }
  pendingFile.value = file
  caption.value = ''
  captionOpen.value = true
}

const cancelPublish = () => {
  captionOpen.value = false
  pendingFile.value = null
  caption.value = ''
}

const publish = async () => {
  const file = pendingFile.value
  if (!file) return
  const ok = await stories.publish(file, caption.value.trim())
  if (!ok) {
    Notify.create({ message: stories.error || 'Не удалось опубликовать историю', timeout: 4000 })
    return
  }
  cancelPublish()
  Notify.create({ message: 'История опубликована на 24 часа', timeout: 3000 })
}
</script>

<style scoped>
.stories-strip {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 8px 14px 12px;
  overflow-x: auto;
  /* Совсем тонкая граница: полосу отделяет от списка чуть заметная линия. */
  border-bottom: 1px solid color-mix(in srgb, var(--ms-border) 35%, transparent);
  scrollbar-width: none;
}

.stories-strip::-webkit-scrollbar {
  display: none;
}

.story-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 68px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  flex: 0 0 auto;
  transition: transform 0.15s ease;
}

.story-cell:active {
  transform: scale(0.96);
}

.story-avatar,
.story-avatar-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
}

.story-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-weight: 600;
  color: var(--ms-on-accent);
  background: var(--ms-accent);
  border: 2px solid var(--ms-surface);
  box-shadow: 0 0 0 2px var(--ms-border);
}

.story-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Непросмотренная история — акцентное кольцо (как в мессенджерах). */
.story-avatar.unseen {
  box-shadow: 0 0 0 2.5px var(--ms-accent);
}

.story-avatar-btn:active .story-avatar,
.story-cell:active .story-avatar {
  box-shadow: 0 0 0 3px var(--ms-accent);
}

.story-avatar.empty {
  background: var(--ms-surface-2);
  color: var(--ms-muted);
}

.story-avatar-btn {
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
}

.story-add {
  position: relative;
  margin-top: -13px;
  margin-left: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--ms-surface);
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  box-shadow: var(--ms-shadow-sm);
  cursor: pointer;
}

.story-add.busy {
  background: var(--ms-muted-2);
}

.story-name {
  max-width: 68px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.1px;
  color: var(--ms-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.story-hint {
  align-self: center;
  margin: 0;
  padding-left: 2px;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--ms-muted-3);
}

.hidden-file {
  display: none;
}

.story-caption-card {
  width: min(360px, calc(100vw - 32px));
}

.story-caption-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--ms-text-strong);
}

.story-caption-hint {
  margin: 4px 0 10px;
  font-size: 12.5px;
  color: var(--ms-muted);
}

.story-caption-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  background: var(--ms-surface-2);
  color: var(--ms-text);
  font: inherit;
}

.story-caption-error {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--ms-danger);
}

.mini-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--ms-on-accent) 50%, transparent);
  border-top-color: var(--ms-on-accent);
  border-radius: 50%;
  animation: story-spin 0.8s linear infinite;
}

@keyframes story-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
