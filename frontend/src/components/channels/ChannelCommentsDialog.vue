<template>
  <q-card class="ch-comments-card" :class="{ 'ch-comments-card--full': fullscreen }">
    <q-card-section class="row no-wrap items-center ch-comments-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">
        Комментарии<template v-if="comments.length"> · {{ comments.length }}</template>
      </div>
      <q-space />
      <q-btn flat round dense icon="close" v-close-popup :aria-label="t('Закрыть')" />
    </q-card-section>
    <q-separator />

    <q-card-section class="ch-comments-body">
      <!-- О чём обсуждение: сначала автор поста, затем его текст. Раньше обе
           строки шли с префиксом «Пост:», и короткий пост читался как подпись
           автора («Пост: Имя2») — в Telegram на этом месте просто цитата. -->
      <p v-if="postAuthor" class="ch-comments-author">{{ postAuthor }}</p>
      <p class="ch-comments-post">{{ postPreview }}</p>

      <p v-if="loading" class="ch-comments-empty">{{ t('Загружаем…') }}</p>
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
                :aria-label="t('Удалить комментарий')"
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
        :placeholder="canComment ? t('Ваш комментарий') : t('Комментировать могут подписчики')"
        :disabled="!canComment"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button
        class="ch-comments-send"
        type="button"
        :disabled="!canComment || !draft.trim() || sending"
        :aria-label="t('Отправить комментарий')"
        @click="send"
      >
        <!-- Крутилку красим наследованием от кнопки (`--ms-on-accent`), а не
             пропом `color`: он берёт только палитру Quasar, и сторож
             `quasarCss.spec.ts` справедливо ругается на `on-accent`. -->
        <q-spinner v-if="sending" size="18px" />
        <q-icon v-else :name="icon('send')" size="20px" />
      </button>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Notify } from 'quasar'

import { addComment, deleteComment, fetchComments } from '@/services/channelService'
import { getErrorMessage } from '@/services/errors'
import { t } from '@/i18n'
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
  /**
   * Открыт отдельным экраном (телефон/планшет), а не карточкой поверх ленты:
   * тогда карточка занимает весь экран, без скруглений и с учётом safe-area.
   */
  fullscreen?: boolean
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
  /* Скругление, фон и тень задаёт общее правило окон
     (`html .q-dialog__inner > .q-card`, см. docs/design-system.md). */
  background: var(--ms-surface, #fff);
  color: var(--ms-text, #141d26);
  font-family: var(--ms-font), sans-serif;
}

/**
 * Отдельный экран (телефон/планшет): карточка на весь экран.
 *
 * Класс-модификатор, а не расчёт на `.q-dialog__inner--maximized > div`: у
 * Quasar это «класс + элемент» (0,1,1), а правило компонента со scope-атрибутом
 * сильнее (0,2,0) — иначе карточка осталась бы по центру с полями.
 *
 * Селектор с предком обязателен: общее правило модальных окон
 * (`html .q-dialog__inner > .q-card`, 0,2,1) задаёт скругление всем окнам и
 * без предка перебило бы `border-radius: 0` у полноэкранной карточки.
 */
html .q-dialog__inner > .ch-comments-card--full {
  border-radius: 0;
}

.ch-comments-card--full {
  width: 100%;
  height: 100%;
  max-height: none;
}

/* Низ экрана на телефоне занят жестовой полосой — кнопку отправки поднимаем. */
.ch-comments-card--full .ch-comments-compose {
  padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
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

.ch-comments-author {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
}

.ch-comments-post {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ms-muted, #71808d);
  /* Текст поста — цитата: по левой полосе видно, где кончается пост и
     начинаются комментарии. */
  padding-left: 8px;
  border-left: 2px solid var(--ms-border, #dfe5ea);
  white-space: pre-wrap;
  word-break: break-word;
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

/* Аватар в комментарии — компактный (в списках чатов он 46px): здесь строк
   много, и крупные кружки съедали высоту. Размер задан явно, иначе картинка
   рисуется в натуральную величину. */
.ch-comment .avatar {
  width: 34px;
  height: 34px;
  font-size: var(--ms-fs-sm);
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
  /* Кнопка по центру строки ввода, а не по её низу: у двухстрочного поля
     нижнее выравнивание читалось как «съехавшая» кнопка. */
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
}

/* Кнопка отправки: обычная кнопка со своими стилями, а НЕ `q-btn` с настройками
   размера. ГРАБЛЯ: проп `size` у `q-btn` задаёт высоту в `em` — вместе с нашей
   шириной 38px получался овал 38×48, а иконка вырастала до 34px и упиралась в
   край круга. Здесь и круг, и иконка заданы явно. */
.ch-comments-send {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--ms-accent, #2ea25e);
  color: var(--ms-on-accent, #ffffff);
  cursor: pointer;
}

.ch-comments-send:hover:not(:disabled) {
  background: var(--ms-accent-strong, #2b8b53);
}

.ch-comments-send:disabled {
  opacity: 0.5;
  cursor: default;
}

.ch-input {
  flex: 1;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: var(--ms-radius-md);
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
