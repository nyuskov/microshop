<template>
  <q-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event === true)"
  >
    <q-card class="pk-card">
      <q-card-section class="pk-head">
        <q-icon class="pk-shield" :name="icon('shield')" size="20px" aria-hidden="true" />
        <div class="pk-title">{{ t('Собеседник сменил ключ шифрования') }}</div>
        <q-space />
        <q-btn flat round dense :icon="icon('close')" v-close-popup :aria-label="t('Закрыть')" />
      </q-card-section>
      <q-separator />
      <q-card-section class="pk-body">
        <p class="pk-lead">{{ lead }}</p>

        <p class="pk-danger">
          <q-icon :name="icon('warning')" size="16px" aria-hidden="true" />
          <span>{{
            t(
              'Если это не он, новые сообщения сможет читать тот, кто получил доступ к его аккаунту.'
            )
          }}</span>
        </p>

        <p class="pk-foot">
          <q-icon :name="icon('lock')" size="15px" aria-hidden="true" />
          <span>{{
            t(
              'Сверьте код проверки в карточке чата или спросите его лично. Пока не сверили — не отправляйте сюда пароли и коды.'
            )
          }}</span>
        </p>

        <div class="pk-actions">
          <q-btn
            unelevated
            no-caps
            color="primary"
            :label="t('Это его устройство')"
            @click="accept"
          />
          <q-btn flat no-caps :label="t('Проверю позже')" v-close-popup />
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Предупреждение о смене ключа собеседника (TOFU для E2EE).
 *
 * Ключ сквозного шифрования привязан к устройству, поэтому он меняется при входе
 * с нового устройства — и это нормально. Плохой случай тот же: подменить ключ
 * может и тот, кто угнал аккаунт, чтобы читать чужую переписку (MITM). Сервер
 * отличить эти случаи не может, а человек — может (он знает, менял ли друг
 * телефон), поэтому приложение обязано спросить, а не шифровать молча.
 *
 * Текст держим в три короткие строки с разной ролью: что случилось, чем это
 * плохо, что делать. Длинные абзацы тут не читают (замечание 19.09.2026: «слишком
 * много текста»), а решение человеку нужно принять за пару секунд.
 */
import { computed } from 'vue'

import { icon } from '@/utils/icons'
import { t } from '@/i18n'

const props = defineProps<{
  modelValue: boolean
  /** Имя собеседника для текста (пусто — если не смогли определить). */
  peerName?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** Человек подтвердил новое устройство — больше не предупреждаем. */
  (e: 'accept'): void
}>()

/** Что случилось: одна строка с именем собеседника, если оно известно. */
const lead = computed<string>(() =>
  props.peerName
    ? `У «${props.peerName}» новое устройство — так бывает, когда входят с телефона или компьютера.`
    : 'У собеседника новое устройство — так бывает, когда входят с телефона или компьютера.'
)

const accept = () => {
  emit('accept')
  emit('update:modelValue', false)
}
</script>

<style scoped>
.pk-card {
  width: min(440px, calc(100vw - 32px));
  border-radius: var(--ms-radius-lg, 18px);
}

.pk-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 8px 8px 8px 20px;
}

.pk-shield {
  color: var(--ms-accent);
}

.pk-title {
  font-weight: 600;
}

.pk-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pk-lead {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
}

.pk-danger {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.4;
  color: var(--ms-danger);
  background: var(--ms-danger-bg);
  border-radius: var(--ms-radius-sm, 10px);
}

.pk-foot {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ms-muted, #5c6a75);
}

.pk-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  margin-top: 2px;
}
</style>
