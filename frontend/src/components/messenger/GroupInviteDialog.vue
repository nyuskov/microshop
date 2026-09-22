<template>
  <q-dialog :model-value="modelValue" @update:model-value="onUpdate" @hide="emit('close')">
    <q-card class="invite-card">
      <div class="invite-avatar" :style="avatarStyle(preview?.name || 'Группа')">
        <img v-if="avatarUrl" :src="avatarUrl" class="invite-avatar-img" alt="" decoding="async" />
        <template v-else>{{ initials(preview?.name || t('Группа')) }}</template>
      </div>
      <p class="invite-title">{{ t('Приглашение в группу') }}</p>
      <p class="invite-name">{{ preview?.name }}</p>
      <p class="invite-meta">{{ memberText }}</p>
      <p v-if="preview?.description" class="invite-desc">{{ preview.description }}</p>
      <div class="invite-actions">
        <q-btn flat no-caps :label="t('Отмена')" @click="emit('close')" />
        <q-btn
          color="primary"
          no-caps
          :loading="joining"
          :label="t('Войти')"
          @click="emit('join')"
        />
      </div>
      <p v-if="error" class="invite-error">{{ error }}</p>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Карточка приглашения в группу (открывается по ссылке `/j/<токен>`).
 *
 * Показываем, КУДА зовут: до этого человек в группе не состоит, поэтому
 * название, аватар и число участников видны заранее, а вход — только по кнопке.
 *
 * Компонент грузится отдельным чанком (`defineAsyncComponent` в Messenger.vue):
 * он нужен только тем, кто открыл ссылку-приглашение, а основной бандл у нас под
 * бюджетом размера.
 */
import { computed } from 'vue'
import type { GroupInvitePreview } from '@/types'
import { avatarStyle, avatarUrlOf, initials } from '@/utils/user'
import { t } from '@/i18n'

const props = defineProps<{
  modelValue: boolean
  preview: GroupInvitePreview | null
  /** Идёт вход в группу (кнопка «Войти» показывает загрузку). */
  joining?: boolean
  error?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'close'): void
  (e: 'join'): void
}>()

const onUpdate = (value: boolean) => emit('update:modelValue', value)

/** Аватар группы: миниатюра, если она есть (иначе инициалы). */
const avatarUrl = computed<string | undefined>(() =>
  avatarUrlOf(props.preview as unknown as { avatar_url?: string | null })
)

/** Число участников словами: «1 участник», «2 участника», «5 участников». */
const memberText = computed<string>(() => {
  const count = props.preview?.member_count ?? 0
  const last = count % 10
  const lastTwo = count % 100
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} участников`
  if (last === 1) return `${count} участник`
  if (last >= 2 && last <= 4) return `${count} участника`
  return `${count} участников`
})
</script>

<style scoped>
.invite-card {
  width: min(360px, calc(100vw - 40px));
  padding: 22px 20px 18px;
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #141d26);
}

.invite-avatar {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-on-accent);
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 4px;
}

.invite-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.invite-title {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
}

.invite-name {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.invite-meta {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted, #5c6a75);
}

.invite-desc {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ms-muted, #71808d);
  max-height: 84px;
  overflow: hidden;
}

.invite-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.invite-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--ms-danger, #d64545);
}
</style>
