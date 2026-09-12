<template>
  <Teleport to="body">
    <div
      v-if="current"
      ref="trapContainer"
      class="lb-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
      tabindex="-1"
      @click.self="emit('close')"
    >
      <div class="lb-topbar">
        <span class="lb-name" :title="current.name">{{ current.name }}</span>
        <span v-if="images.length > 1" class="lb-count">{{ index + 1 }} / {{ images.length }}</span>
        <a
          v-if="current.url"
          class="lb-icon-btn lb-download"
          :href="current.url"
          :download="current.name"
          target="_blank"
          rel="noopener"
          title="Скачать"
          aria-label="Скачать изображение"
        >
          <q-icon :name="icon('download')" size="22px" />
        </a>
        <button class="lb-icon-btn lb-close" title="Закрыть (Esc)" @click="emit('close')">
          <q-icon :name="icon('close')" size="24px" />
        </button>
      </div>

      <button
        v-if="images.length > 1"
        class="lb-icon-btn lb-nav lb-prev"
        title="Назад (←)"
        aria-label="Предыдущее изображение"
        @click.stop="emit('prev')"
      >
        <q-icon :name="icon('chevron_left')" size="32px" />
      </button>

      <img
        v-if="current.url"
        :key="current.id"
        :src="current.url"
        :alt="current.name"
        class="lb-image"
        decoding="async"
        @click.stop
      />
      <!-- Зашифрованное вложение расшифровывается по запросу (см. utils/lightbox):
           пока ссылки нет, показываем ожидание, а не «битую» картинку. -->
      <div v-else class="lb-loading" role="status" aria-live="polite">
        <q-spinner size="34px" color="primary" />
        <span class="lb-loading-text">Открываем изображение…</span>
      </div>

      <button
        v-if="images.length > 1"
        class="lb-icon-btn lb-nav lb-next"
        title="Вперёд (→)"
        aria-label="Следующее изображение"
        @click.stop="emit('next')"
      >
        <q-icon :name="icon('chevron_right')" size="32px" />
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useFocusTrap } from '@/composables/useFocusTrap'

export interface LightboxImage {
  id: number
  url: string
  name: string
}

const props = defineProps<{
  images: LightboxImage[]
  index: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'prev'): void
  (e: 'next'): void
}>()

const current = computed<LightboxImage | null>(() => props.images[props.index] ?? null)

// Лайтбокс — свой оверлей: Tab не должен уходить на страницу под ним.
const { container: trapContainer } = useFocusTrap(() => current.value !== null)

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'ArrowLeft') emit('prev')
  else if (event.key === 'ArrowRight') emit('next')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.lb-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 10, 14, 0.94);
  animation: lb-fade 0.15s ease-out;
}

@keyframes lb-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.lb-image {
  max-width: 92vw;
  max-height: 86vh;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  user-select: none;
}

.lb-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: linear-gradient(rgba(0, 0, 0, 0.55), transparent);
  color: #fff;
}

.lb-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lb-count {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
}

.lb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s;
}

.lb-icon-btn:hover {
  background: rgba(255, 255, 255, 0.24);
}

.lb-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 46px;
  height: 46px;
}

.lb-prev {
  left: 16px;
}

.lb-next {
  right: 16px;
}

/* Ожидание расшифровки E2EE-кадра: текст и спиннер в стиле верхней панели */
.lb-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: #fff;
}

.lb-loading-text {
  font-size: 13px;
  opacity: 0.85;
}
</style>
