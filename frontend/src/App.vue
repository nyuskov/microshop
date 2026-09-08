<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { applyServiceWorkerUpdate, registerServiceWorker } from '@/services/pwa'

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
  background: #171e26;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 8px 10px 8px 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
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
  background: #2ea25e;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  padding: 7px 14px;
  cursor: pointer;
}

.pwa-update-btn:hover {
  background: #39b56c;
}
</style>
