<template>
  <Transition name="drop-fade">
    <div v-if="active" class="drop-overlay" :class="{ 'cannot-send': !canSend }" aria-hidden="true">
      <div class="drop-card">
        <q-icon :name="icon(canSend ? 'attach_file' : 'chat_bubble')" size="28px" />
        <span class="drop-title">
          {{ canSend ? 'Отпустите файл, чтобы прикрепить' : 'Откройте чат, чтобы прикрепить файл' }}
        </span>
        <span v-if="canSend" class="drop-note">{{
          t('Можно перетащить несколько файлов сразу')
        }}</span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { t } from '@/i18n'

/**
 * Подсказка при перетаскивании файлов в окно: файл можно бросить в любом месте
 * (см. `useFileDrop`), поэтому и подсказка одна на всё приложение.
 *
 * Слой прозрачен для мыши (`pointer-events: none`) — иначе бросок попадал бы в
 * него самого, а не в ленту сообщений под ним.
 */
defineProps<{
  /** Над окном сейчас тянут файл(ы). */
  active: boolean
  /** Есть открытый чат, куда этот файл попадёт. */
  canSend: boolean
}>()
</script>

<style scoped>
.drop-overlay {
  position: absolute;
  inset: 0;
  /* Выше шапки и композера, ниже диалогов Quasar (у них 6000+). */
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ms-scrim-soft);
  pointer-events: none;
}

.drop-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: min(420px, 100%);
  padding: 22px 30px;
  border: 2px dashed var(--ms-accent);
  border-radius: 18px;
  background: var(--ms-surface);
  box-shadow: var(--ms-shadow-pop);
  color: var(--ms-accent);
  text-align: center;
}

.drop-title {
  font-size: 14.5px;
  font-weight: 600;
}

.drop-note {
  font-size: 12px;
  color: var(--ms-muted-2);
}

/* Чат не открыт: бросок ничего не отправит — подсказка нейтральная, а не «жми». */
.cannot-send .drop-card {
  border-color: var(--ms-muted-3);
  color: var(--ms-text-strong);
}

.drop-fade-enter-active,
.drop-fade-leave-active {
  transition: opacity 0.12s ease;
}

.drop-fade-enter-from,
.drop-fade-leave-to {
  opacity: 0;
}
</style>
