<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="mod-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="text-subtitle1 text-weight-medium">{{ t('Жалоба') }}</div>
        <q-space />
        <q-btn flat round dense icon="close" :aria-label="t('Закрыть')" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="mod-body">
        <p class="mod-hint">
          Жалоба на <strong>{{ userName }}</strong
          ><template v-if="messagePreview"> — сообщение: «{{ messagePreview }}»</template>. Мы
          проверим её и примем меры.
        </p>

        <div class="mod-reasons">
          <button
            v-for="option in REPORT_REASONS"
            :key="option.value"
            type="button"
            class="mod-reason"
            :class="{ active: reason === option.value }"
            @click="reason = option.value"
          >
            <q-icon
              :name="
                icon(reason === option.value ? 'radio_button_checked' : 'radio_button_unchecked')
              "
              size="18px"
            />
            <span>{{ option.label }}</span>
          </button>
        </div>

        <label class="mod-label" for="report-comment">{{ t('Комментарий (необязательно)') }}</label>
        <textarea
          id="report-comment"
          v-model="comment"
          class="mod-textarea"
          rows="3"
          maxlength="1000"
          :placeholder="t('Что не так с этим пользователем или сообщением?')"
        ></textarea>

        <p v-if="error" class="mod-error" role="alert">{{ error }}</p>

        <p class="mod-rules">
          Что считается нарушением —
          <a href="/community.html" target="_blank" rel="noopener">{{ t('правила сообщества') }}</a>.
        </p>
      </q-card-section>

      <q-separator />
      <q-card-actions class="row justify-end q-gutter-sm q-pa-md">
        <q-btn flat no-caps :label="t('Отмена')" @click="emit('close')" />
        <q-btn
          unelevated
          no-caps
          color="primary"
          :label="t('Отправить жалобу')"
          :loading="sending"
          @click="submit"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { ref } from 'vue'

import { REPORT_REASONS, reportUser, type ReportReason } from '@/services/moderation'
import { getErrorMessage } from '@/services/errors'
import { t } from '@/i18n'

const props = defineProps<{
  /** ID пользователя, на которого жалуемся. */
  userId: number
  /** Имя для заголовка. */
  userName: string
  /** Диалог, где произошло нарушение (контекст жалобы). */
  chatId?: number
  /** Сообщение, на которое жалуемся (если жалоба не «на пользователя целиком»). */
  messageId?: number
  /** Короткий текст сообщения — показываем в описании. */
  messagePreview?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'sent'): void
}>()

const reason = ref<ReportReason>('spam')
const comment = ref('')
const sending = ref(false)
const error = ref('')

const submit = async () => {
  if (sending.value) return
  sending.value = true
  error.value = ''
  try {
    await reportUser({
      userId: props.userId,
      reason: reason.value,
      comment: comment.value,
      chatId: props.chatId,
      messageId: props.messageId
    })
    emit('sent')
    emit('close')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось отправить жалобу')
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.mod-card {
  width: min(460px, calc(100vw - 32px));
  border-radius: 18px;
}

.mod-body {
  max-height: 62vh;
  overflow: auto;
}

.mod-hint {
  margin: 0 0 14px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--ms-muted);
}

.mod-reasons {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 14px;
}

.mod-reason {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mod-reason:hover {
  background: var(--ms-surface-2, rgba(127, 127, 127, 0.08));
}

.mod-reason.active {
  color: var(--ms-accent, #2ea25e);
  font-weight: 500;
}

.mod-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--ms-muted);
}

.mod-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: 11px;
  background: var(--ms-surface-2, #f7f9fb);
  color: inherit;
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
}

.mod-error {
  margin: 10px 0 0;
  color: var(--ms-danger);
  font-size: 13px;
}

/* Ссылка на правила сообщества: жалобу проще обосновать, когда видно правила. */
.mod-rules {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--ms-muted-3);
}

.mod-rules a {
  color: var(--ms-accent, #2ea25e);
  font-weight: 600;
  text-decoration: none;
}

.mod-rules a:hover {
  text-decoration: underline;
}
</style>
