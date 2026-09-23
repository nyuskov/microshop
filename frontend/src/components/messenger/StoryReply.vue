<template>
  <div class="story-reply">
    <span class="story-reply-thumb">
      <img v-if="thumb && !isVideo" :src="thumb" alt="" loading="lazy" decoding="async" />
      <q-icon v-else :name="icon(isVideo ? 'videocam' : 'image')" size="16px" aria-hidden="true" />
    </span>
    <span class="story-reply-text">{{ t('Ответ на историю') }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * Ответ на историю: снимок медиа истории, который живёт и после её удаления.
 *
 * Вынесено из `MessageRow.vue`. Снимок может быть картинкой или видео — тогда
 * вместо миниатюры показываем значок камеры: превью видео сервер не делает.
 */

import { computed } from 'vue'

import { icon } from '@/utils/icons'
import { t } from '@/i18n'
import { mediaUrl } from '@/config'
import type { Message } from '@/types'

const props = defineProps<{
  /** Снимок истории из сообщения (`message.reply_to_story`). */
  story: NonNullable<Message['reply_to_story']>
}>()

/** Миниатюра истории: путь к нашему файлу, поэтому через `mediaUrl`. */
const thumb = computed<string>(() => {
  const url = props.story.media_url
  return url ? mediaUrl(url) : ''
})

const isVideo = computed<boolean>(() => Boolean(props.story.mime_type?.startsWith('video/')))
</script>

<style scoped>
/* Плашка «Ответ на историю»: миниатюра + подпись, вид как у цитаты. */
.story-reply {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: color-mix(in srgb, var(--ms-icon) 8%, transparent);
  border-left: 3px solid var(--ms-accent);
  border-radius: var(--ms-radius-xs);
  padding: 4px 9px 4px 6px;
  margin-bottom: 5px;
  min-width: 120px;
}

.story-reply-thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--ms-surface-2);
  color: var(--ms-muted-2);
  flex: none;
}

.story-reply-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.story-reply-text {
  font-size: 12.5px;
  color: var(--ms-muted);
}
</style>
