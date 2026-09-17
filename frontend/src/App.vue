<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { applyServiceWorkerUpdate, registerServiceWorker } from '@/services/pwa'
import { useVisualViewport } from '@/composables/useVisualViewport'
import { useMaintenanceWatch } from '@/composables/useMaintenanceWatch'
import { useAuthStore } from '@/stores/auth'
import OfflineBanner from '@/components/common/OfflineBanner.vue'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import ExternalLinkDialog from '@/components/common/ExternalLinkDialog.vue'
import FatalErrorScreen from '@/components/common/FatalErrorScreen.vue'
import MaintenanceScreen from '@/components/common/MaintenanceScreen.vue'
import { setMaintenanceExempt } from '@/utils/maintenance'

// Высота с учётом экранной клавиатуры — нужна всему приложению (и логину тоже).
useVisualViewport()

// Режим технических работ: пока он включён, вместо приложения — экран-заглушка
// (включает его администратор из админской панели). Администратору экран не
// показываем: иначе он не смог бы вернуться в панель и выключить режим.
const authStore = useAuthStore()
watch(() => authStore.isAdmin, setMaintenanceExempt, { immediate: true })
useMaintenanceWatch()

// Связь: пока сверху висит плашка «нет сети»/«Соединение…», баннер обновления
// сдвигается вниз, иначе они перекрыли бы друг друга.
const { bannerVisible: connectionBannerVisible } = useOnlineStatus()

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
  <div
    v-if="updateAvailable"
    class="pwa-update-bar"
    :class="{ shifted: connectionBannerVisible }"
    role="status"
  >
    <span class="pwa-update-text">Доступна новая версия приложения</span>
    <button type="button" class="pwa-update-btn" @click="onUpdateClick">Обновить</button>
  </div>
  <!-- Нет сети / связь восстановлена (работает и на экране входа) -->
  <OfflineBanner />
  <!-- Подтверждение перехода на внешний сайт (окно одно на всё приложение) -->
  <ExternalLinkDialog />
  <!-- Плановые технические работы: сервис отвечает 503, приложение закрыто -->
  <MaintenanceScreen />
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

.pwa-update-bar.shifted {
  top: 44px;
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
