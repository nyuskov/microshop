<template>
  <transition name="offline-fade">
    <div
      v-if="!online || justRestored"
      class="offline-banner"
      :class="{ restored: online }"
      role="status"
      aria-live="polite"
    >
      <q-icon :name="online ? 'wifi' : 'wifi_off'" size="17px" aria-hidden="true" />
      <span>{{ online ? 'Связь восстановлена' : 'Нет подключения к интернету' }}</span>
      <span v-if="!online" class="offline-hint">Сообщения отправятся, когда связь вернётся</span>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { useOnlineStatus } from '@/composables/useOnlineStatus'

const { online, justRestored } = useOnlineStatus()
</script>

<style scoped>
/* Плашка снизу по центру: сверху уже висит баннер обновления PWA. */
.offline-banner {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 19000;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
  background: #2b333c;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
}

.offline-banner.restored {
  background: #2ea25e;
  border-color: transparent;
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

.offline-fade-enter-active,
.offline-fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.offline-fade-enter-from,
.offline-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .offline-fade-enter-active,
  .offline-fade-leave-active {
    transition: none;
  }
}
</style>
