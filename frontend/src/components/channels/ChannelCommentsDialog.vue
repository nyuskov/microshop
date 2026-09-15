<template>
  <q-card class="ch-comments-card">
    <q-card-section class="row no-wrap items-center ch-comments-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">
        Комментарии<template v-if="comments.length"> · {{ comments.length }}</template>
      </div>
      <q-space />
      <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
    </q-card-section>
    <q-separator />

    <q-card-section class="ch-comments-body">
      <p v-if="postAuthor" class="ch-comments-post">Пост: {{ postAuthor }}</p>
      <p class="ch-comments-post">{{ postPreview }}</p>

      <p v-if="loading" class="ch-comments-empty">Загружаем…</p>
      <p v-else-if="!comments.length" class="ch-comments-empty">
        Пока никто не комментировал. Будьте первым.
      </p>
      <div v-else class="ch-comments-list">
        <div v-for="comment in comments" :key="comment.id" class="ch-comment">
          <span class="avatar" :style="avatarStyle(comment.name)">
            <img
              v-if="comment.avatar_url"
              :src="comment.avatar_url"
              class="avatar-img"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <template v-else>{{ initials(comment.name) }}</template>
          </span>
          <div class="ch-comment-text">
            <div class="ch-comment-head">
              <span class="ch-comment-name">{{ comment.name }}</span>
              <span class="ch-comment-time">{{ formatMsgTime(comment.created_at) }}</span>
              <button
                v-if="comment.can_delete"
                type="button"
                class="ch-comment-del"
                aria-label="Удалить комментарий"
                @click="remove(comment)"
              >
                <q-icon :name="icon('delete')" size="14px" />
              </button>
            </div>
            <p class="ch-comment-body">{{ comment.text }}</p>
          </div>
        </div>
      </div>
    </q-card-section>

    <q-separator />
    <q-card-section class="ch-comments-compose">
      <textarea
        v-model="draft"
        class="ch-input ch-textarea"
        rows="2"
        maxlength="4096"
        :placeholder="canComment ? 'Ваш комментарий' : 'Комментировать могут подписчики'"
        :disabled="!canComment"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <q-btn
        round
        dense
        unelevated
        color="primary"
        :icon="icon('send')"
        :loading="sending"
        :disable="!canComment || !draft.trim()"
        aria-label="Отправить комментарий"
        @click="send"
      />
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Notify } from 'quasar'

import { addComment, deleteComment, fetchComments } from '@/services/channelService'
import { getErrorMessage } from '@/services/errors'
import { avatarStyle, initials } from '@/utils/user'
import { formatMsgTime } from '@/utils/format'
import { icon } from '@/utils/icons'
import type { ChannelComment } from '@/types'

const props = defineProps<{
  chatId: number
  messageId: number
  /** Автор поста и сам текст — чтобы человек видел, что комментирует. */
  postAuthor?: string
  postPreview?: string
  /** Подписан ли человек на канал (иначе комментарии только читает). */
  canComment: boolean
  open: boolean
}>()

/** Сообщаем родителю новое число комментариев (счётчик под постом). */
const emit = defineEmits<{ (e: 'count', payload: { messageId: number; count: number }): void }>()

const comments = ref<ChannelComment[]>([])
const loading = ref(false)
const sending = ref(false)
const draft = ref('')

const load = async () => {
  loading.value = true
  try {
    comments.value = await fetchComments(props.chatId, props.messageId)
    emit('count', { messageId: props.messageId, count: comments.value.length })
  } catch (error) {
    Notify.create({ type: 'negative', message: getErrorMessage(error) })
  } finally {
    loading.value = false
  }
}

const send = async () => {
  const text = draft.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    const comment = await addComment(props.chatId, props.messageId, text)
    comments.value = [...comments.value, comment]
    draft.value = ''
    emit('count', { messageId: props.messageId, count: comments.value.length })
  } catch (error) {
    Notify.create({ type: 'negative', message: getErrorMessage(error) })
  } finally {
    sending.value = false
  }
}

const remove = async (comment: ChannelComment) => {
  try {
    await deleteComment(props.chatId, comment.id)
    comments.value = comments.value.filter((item) => item.id !== comment.id)
    emit('count', { messageId: props.messageId, count: comments.value.length })
  } catch (error) {
    Notify.create({ type: 'negative', message: getErrorMessage(error) })
  }
}

/** Открыли — загружаем; сменили пост — перезагружаем. */
watch(
  () => [props.open, props.messageId, props.chatId],
  ([open]) => {
    if (open) void load()
  },
  { immediate: true }
)
</script>

<style scoped>
.ch-comments-card {
  width: min(520px, 94vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: var(--ms-surface, #fff);
  color: var(--ms-text, #141d26);
  font-family: var(--ms-font), sans-serif;
}

.ch-comments-head {
  padding: 12px 14px;
}

.ch-comments-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
}

.ch-comments-post {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ms-muted, #71808d);
}

.ch-comments-empty {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
}

.ch-comments-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ch-comment {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.ch-comment-text {
  flex: 1;
  min-width: 0;
}

.ch-comment-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ch-comment-name {
  font-size: 13px;
  font-weight: 600;
}

.ch-comment-time {
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted, #71808d);
}

.ch-comment-del {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--ms-muted, #71808d);
  cursor: pointer;
  padding: 2px;
}

.ch-comment-body {
  margin: 2px 0 0;
  font-size: 14px;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}

.ch-comments-compose {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 14px;
}

.ch-input {
  flex: 1;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 11px;
  background: var(--ms-surface-2, #ffffff);
  color: var(--ms-text, #1c2733);
  padding: 8px 10px;
  font-size: 14px;
  font-family: var(--ms-font), sans-serif;
}

.ch-textarea {
  resize: none;
  line-height: 1.35;
}

.ch-input:focus {
  outline: none;
  border-color: var(--ms-accent, #2ea25e);
}
</style>
