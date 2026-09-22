<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { applyServiceWorkerUpdate, registerServiceWorker } from '@/services/pwa'
import { useVisualViewport } from '@/composables/useVisualViewport'
import { useMaintenanceWatch } from '@/composables/useMaintenanceWatch'
import { useAuthStore } from '@/stores/auth'
import OfflineBanner from '@/components/common/OfflineBanner.vue'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import ExternalLinkDialog from '@/components/common/ExternalLinkDialog.vue'
import FatalErrorScreen from '@/components/common/FatalErrorScreen.vue'
import MaintenanceScreen from '@/components/common/MaintenanceScreen.vue'
import { setMaintenanceExempt, setMaintenanceViewerAuthenticated } from '@/utils/maintenance'
import { t } from '@/i18n'

// Высота с учётом экранной клавиатуры — нужна всему приложению (и логину тоже).
useVisualViewport()

// Режим технических работ: пока он включён, вместо приложения — экран-заглушка
// (включает его администратор из админской панели). Два исключения, и оба важны:
// администратору экран не показываем (иначе он не вернётся в панель и не выключит
// режим), а экран ВХОДА заглушкой не закрываем — сервер `/auth/` и `/jwt/` для
// этого режима специально открыт, и владелец должен суметь войти и выключить
// работы из приложения, а не искать ssh (инцидент 22.09.2026).
const authStore = useAuthStore()
watch(() => authStore.isAdmin, setMaintenanceExempt, { immediate: true })
watch(() => authStore.isAuthenticated, setMaintenanceViewerAuthenticated, { immediate: true })
useMaintenanceWatch()

// Связь: пока сверху висит плашка «нет сети»/«Соединение…», баннер обновления
// сдвигается вниз, иначе они перекрыли бы друг друга.
const { bannerVisible: connectionBannerVisible } = useOnlineStatus()

// В мессенджере полоса сверху не нужна: состояние связи показывают шапки (список
// чатов — пилюлей, открытый чат — подписью). Так её видно ровно там, где смотрят,
// и она ничего не перекрывает. Вне мессенджера (экран входа, приглашение) шапок
// нет — там полоса остаётся единственным способом сообщить про обрыв.
const MESSENGER_ROUTES = ['Messenger', 'ProfileLink', 'ChannelLink', 'GroupInvite']
const route = useRoute()
const showConnectionBanner = computed(() => !MESSENGER_ROUTES.includes(String(route.name ?? '')))
const bannerOnScreen = computed(() => connectionBannerVisible.value && showConnectionBanner.value)

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
    :class="{ shifted: bannerOnScreen }"
    role="status"
  >
    <span class="pwa-update-text">{{ t('Доступна новая версия приложения') }}</span>
    <button type="button" class="pwa-update-btn" @click="onUpdateClick">
      {{ t('Обновить') }}
    </button>
  </div>
  <!-- Нет сети / связь восстановлена. В мессенджере то же самое показывают шапки
       (см. ConnectionStatus и ChatHeader), поэтому полоса там скрыта. -->
  <OfflineBanner v-if="showConnectionBanner" />
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
