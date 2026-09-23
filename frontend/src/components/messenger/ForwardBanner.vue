<template>
  <div
    v-if="label"
    class="forward-banner"
    :class="{ clickable }"
    :title="clickable ? t('Открыть чат с автором') : undefined"
    @click.stop="onClick"
  >
    <span class="forward-sender-avatar" :style="avatarStyleOf" aria-hidden="true">
      <img
        v-if="avatarUrl"
        :src="avatarUrl"
        class="forward-sender-avatar-img"
        alt=""
        loading="lazy"
        decoding="async"
      />
      <template v-else>{{ initialsOf }}</template>
    </span>
    <span class="forward-label-text">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * Плашка «Переслано от …» над содержимым пузыря.
 *
 * Вынесено из `MessageRow.vue`: строка сообщения отвечает за жест, выделение,
 * реакции и меню, а мелкие части пузыря живут своими компонентами. Клик по
 * плашке открывает чат с автором оригинала — но только если он не я сам.
 */

import { computed } from 'vue'

import { t } from '@/i18n'
import { mediaUrl } from '@/config'
import { avatarStyle, initials } from '@/utils/user'
import type { Message } from '@/types'

const props = defineProps<{
  message: Message
  /** Кто смотрит: на себя плашка не ведёт (пересылка из своего же чата). */
  viewerId: number | null
}>()

const emit = defineEmits<{
  /** Открыть чат с автором оригинала. */
  (e: 'forwarder-click'): void
}>()

/** Текст плашки «Переслано от …» (null, если сообщение не переслано). */
const label = computed<string | null>(() => {
  const forwarded = props.message.forwarded_from
  if (!forwarded) return null
  if (props.viewerId !== null && forwarded.sender_id === props.viewerId) {
    return t('Переслано от вас')
  }
  const name = forwarded.sender_name?.trim()
  return name ? t('Переслано от {name}', { name }) : t('Переслано')
})

const authorName = computed<string>(() => props.message.forwarded_from?.sender_name?.trim() || '')

const avatarUrl = computed<string | null>(() => {
  const url = props.message.forwarded_from?.sender_avatar_url
  return url ? mediaUrl(url) : null
})

const clickable = computed<boolean>(() => {
  const senderId = props.message.forwarded_from?.sender_id
  return senderId !== null && senderId !== undefined && senderId !== props.viewerId
})

const initialsOf = computed<string>(() => initials(authorName.value || '?'))
const avatarStyleOf = computed(() => avatarStyle(authorName.value || '?'))

const onClick = (): void => {
  if (clickable.value) emit('forwarder-click')
}
</script>

<style scoped>
/* Плашка «Переслано от …» (как в Telegram: мелко, над содержимым) */
.forward-banner {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: -1px 0 3px;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ms-info, #3aa6e0);
  letter-spacing: 0.1px;
  user-select: none;
}

.forward-banner.clickable {
  cursor: pointer;
}

.forward-sender-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-on-accent);
  /* Кружок пересылки всего 18 px: текст мельче нечитаем, но и 11.5 px в него
     не влезет — держим 10 px, зато с множителем настройки «Размер текста». */
  font-size: calc(10px * var(--ms-text-scale, 1));
  font-weight: 700;
  overflow: hidden;
}

.forward-sender-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
