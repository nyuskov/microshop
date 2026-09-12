<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { applyServiceWorkerUpdate, registerServiceWorker } from '@/services/pwa'
import { useVisualViewport } from '@/composables/useVisualViewport'
import OfflineBanner from '@/components/common/OfflineBanner.vue'
import ExternalLinkDialog from '@/components/common/ExternalLinkDialog.vue'
import FatalErrorScreen from '@/components/common/FatalErrorScreen.vue'

// Высота с учётом экранной клавиатуры — нужна всему приложению (и логину тоже).
useVisualViewport()

const updateAvailable = ref(false)
let reloading = false

const reloadOnNewWorker = () => {
  if (reloading) return
  reloading = true
  window.location.reload()
}

const onUpdateClick = () => {
  void applyServiceWorkerUpdate()
}

onMounted(() => {
  registerServiceWorker(() => {
    updateAvailable.value = true
  })
  navigator.serviceWorker?.addEventListener('controllerchange', reloadOnNewWorker)
})

onBeforeUnmount(() => {
  navigator.serviceWorker?.removeEventListener('controllerchange', reloadOnNewWorker)
})
</script>

<template>
  <div v-if="updateAvailable" class="pwa-update-bar" role="status">
    <span class="pwa-update-text">Доступна новая версия приложения</span>
    <button type="button" class="pwa-update-btn" @click="onUpdateClick">Обновить</button>
  </div>
  <!-- Нет сети / связь восстановлена (работает и на экране входа) -->
  <OfflineBanner />
  <!-- Подтверждение перехода на внешний сайт (окно одно на всё приложение) -->
  <ExternalLinkDialog />
  <!-- Фатальная ошибка приложения: вместо белого экрана — понятное сообщение -->
  <FatalErrorScreen />
  <router-view></router-view>
</template>

<style scoped>
.pwa-update-bar {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20000;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100vw - 24px);
  background: var(--ms-surface);
  color: var(--ms-text);
  border: 1px solid var(--ms-border);
  border-radius: 12px;
  padding: 8px 10px 8px 14px;
  box-shadow: var(--ms-shadow-pop);
  box-sizing: border-box;
}

.pwa-update-text {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}

.pwa-update-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 9px;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-size: 13px;
  font-weight: 700;
  padding: 7px 14px;
  cursor: pointer;
}

.pwa-update-btn:hover {
  background: var(--ms-accent-strong);
}
</style>
