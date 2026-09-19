<template>
  <transition name="offline-slide">
    <div
      v-if="bannerVisible"
      class="offline-banner"
      :class="{ restored: online && !syncing, connecting: online && syncing }"
      role="status"
      aria-live="polite"
    >
      <q-icon :name="icon(iconName)" size="17px" aria-hidden="true" />
      <span>{{ text }}</span>
      <span v-if="!online" class="offline-hint">Сообщения отправятся, когда связь вернётся</span>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { icon } from '@/utils/icons'
import { useOnlineStatus } from '@/composables/useOnlineStatus'

const { online, justRestored, syncing, bannerVisible } = useOnlineStatus()

/**
 * Что показывает плашка:
 *  - нет связи — «нет подключения» (серая);
 *  - связь вернулась и мы добираем данные — «Соединение…» (как в Telegram);
 *  - данные добраны — «Связь восстановлена» (зелёная) на пару секунд.
 */
const text = computed(() => {
  if (!online.value) return 'Нет подключения к интернету'
  if (syncing.value) return 'Соединение…'
  if (justRestored.value) return 'Связь восстановлена'
  return ''
})

const iconName = computed(() => {
  if (!online.value) return 'wifi_off'
  if (syncing.value) return 'refresh'
  return 'wifi'
})
</script>

<style scoped>
/* Полоса во всю ширину сверху — как «Соединение…» в Telegram: её нельзя не
   заметить, и она не перекрывает поле ввода сообщения. */
.offline-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 21000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-sizing: border-box;
  background: #2b333c;
  color: #fff;
  padding: calc(6px + env(safe-area-inset-top, 0px)) 12px 6px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: var(--ms-shadow-md);
}

.offline-banner.restored {
  background: #2ea25e;
}

/* «Соединение…» — спокойный цвет: связь уже есть, идёт догрузка. */
.offline-banner.connecting {
  background: #3a4550;
}

.offline-hint {
  font-weight: 500;
  opacity: 0.72;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* На узких экранах подсказка не помещается — оставляем главный текст. */
@media (max-width: 520px) {
  .offline-hint {
    display: none;
  }
}

/* Иконка «идёт соединение» крутится, пока добираем данные. */
.offline-banner.connecting .q-icon {
  animation: offline-spin 1.4s linear infinite;
}

@keyframes offline-spin {
  to {
    transform: rotate(360deg);
  }
}

.offline-slide-enter-active,
.offline-slide-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.offline-slide-enter-from,
.offline-slide-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}

@media (prefers-reduced-motion: reduce) {
  .offline-slide-enter-active,
  .offline-slide-leave-active {
    transition: none;
  }

  .offline-banner.connecting .q-icon {
    animation: none;
  }
}
</style>
