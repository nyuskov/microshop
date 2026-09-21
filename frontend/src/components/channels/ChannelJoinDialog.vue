<template>
  <q-card class="ch-join-card">
    <q-card-section class="row no-wrap items-center ch-join-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">{{ t('Канал') }}</div>
      <q-space />
      <q-btn flat round dense icon="close" v-close-popup :aria-label="t('Закрыть')" />
    </q-card-section>
    <q-separator />
    <q-card-section class="ch-join-body">
      <p v-if="loading" class="ch-hint">{{ t('Загружаем канал…') }}</p>
      <p v-else-if="error" class="ch-error">{{ error }}</p>
      <template v-else-if="channel">
        <span class="avatar avatar-lg" :style="avatarStyle(channel.title)">
          <img
            v-if="channel.avatar_thumb_url || channel.avatar_url"
            :src="(channel.avatar_thumb_url || channel.avatar_url) as string"
            class="avatar-img"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <template v-else>{{ initials(channel.title) }}</template>
        </span>
        <h2 class="ch-join-title">{{ channel.title }}</h2>
        <p class="ch-join-sub">
          <template v-if="channel.username">@{{ channel.username }} · </template>
          {{ channel.subscribers }}
          {{
            plural(
              channel.subscribers,
              ['подписчик', 'подписчика', 'подписчиков'],
              ['subscriber', 'subscribers']
            )
          }}
          · {{ channel.posts }}
          {{ plural(channel.posts, ['пост', 'поста', 'постов'], ['post', 'posts']) }}
        </p>
        <p v-if="channel.description" class="ch-join-desc">{{ channel.description }}</p>
        <q-btn
          v-if="!channel.role"
          unelevated
          color="primary"
          :label="t('Подписаться')"
          :loading="joining"
          @click="subscribe"
        />
        <q-btn v-else flat color="primary" :label="t('Открыть канал')" @click="open" />
        <q-btn
          v-if="channel.role && channel.role !== 'creator'"
          flat
          color="negative"
          :label="t('Отписаться')"
          @click="unsubscribe"
        />
      </template>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { fetchChannelByUsername, joinChannel, leaveChannel } from '@/services/channelService'
import { getErrorMessage } from '@/services/errors'
import { plural, t } from '@/i18n'
import { avatarStyle, initials } from '@/utils/user'
import type { ChannelCard } from '@/types'

const props = defineProps<{
  /** Публичный адрес канала из ссылки `/c/<username>`. */
  username: string
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'joined', channel: ChannelCard): void
  (e: 'left'): void
}>()

const channel = ref<ChannelCard | null>(null)
const loading = ref(false)
const joining = ref(false)
const error = ref('')

const load = async () => {
  if (!props.username) return
  loading.value = true
  error.value = ''
  try {
    channel.value = await fetchChannelByUsername(props.username)
  } catch (err) {
    error.value = getErrorMessage(err)
  } finally {
    loading.value = false
  }
}

const subscribe = async () => {
  if (!channel.value) return
  joining.value = true
  try {
    channel.value = await joinChannel(channel.value.id)
    emit('joined', channel.value)
  } catch (err) {
    error.value = getErrorMessage(err)
  } finally {
    joining.value = false
  }
}

const unsubscribe = async () => {
  if (!channel.value) return
  try {
    await leaveChannel(channel.value.id)
    emit('left')
  } catch (err) {
    error.value = getErrorMessage(err)
  }
}

const open = () => {
  if (channel.value) emit('joined', channel.value)
}

watch(
  () => [props.open, props.username],
  ([open]) => {
    if (open) void load()
  },
  { immediate: true }
)
</script>

<style scoped>
.ch-join-card {
  width: min(420px, 92vw);
  border-radius: 16px;
  background: var(--ms-surface, #fff);
  color: var(--ms-text, #141d26);
  font-family: var(--ms-font), sans-serif;
}

.ch-join-head {
  padding: 12px 14px;
}

.ch-join-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  padding: 18px 16px 22px;
}

.avatar-lg {
  width: 64px;
  height: 64px;
  font-size: 22px;
}

.ch-join-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.ch-join-sub {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
}

.ch-join-desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.4;
  white-space: pre-wrap;
}

.ch-hint {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
}

.ch-error {
  margin: 0;
  font-size: 13px;
  color: var(--ms-danger, #d64545);
}
</style>
