<template>
  <!-- Нижняя навигация: основные разделы приложения -->
  <nav class="bottom-nav" aria-label="Разделы">
    <button
      class="bottom-nav-btn"
      :class="{ active: view === 'chats' }"
      type="button"
      @click="emit('to-chats')"
    >
      <q-icon :name="icon('forum')" size="22px" />
      <span>Чаты</span>
      <span v-if="unreadCount" class="bottom-nav-badge">{{
        unreadCount > 99 ? '99+' : unreadCount
      }}</span>
    </button>
    <button
      class="bottom-nav-btn"
      :class="{ active: view === 'stories' }"
      type="button"
      @click="emit('to-stories')"
    >
      <q-icon :name="icon('auto_stories')" size="22px" />
      <span>Истории</span>
      <span v-if="hasUnseenStories" class="bottom-nav-dot"></span>
    </button>
    <button
      class="bottom-nav-btn"
      :class="{ active: view === 'contacts' }"
      type="button"
      @click="emit('to-contacts')"
    >
      <q-icon :name="icon('group')" size="22px" />
      <span>Контакты</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'

defineProps<{
  view: 'chats' | 'stories' | 'contacts'
  unreadCount?: number
  hasUnseenStories?: boolean
}>()

const emit = defineEmits<{
  (e: 'to-chats'): void
  (e: 'to-stories'): void
  (e: 'to-contacts'): void
}>()
</script>

<style scoped>
/* «Плавающая» панель разделов: отступ от краёв экрана, радиус, рамка и мягкая
   тень. Тон панели отличается от полотна, рамка полноцветная (не полупрозрачная),
   тень даёт «подъём» — иначе панель выглядит бледной и непонятно, где границы. */
.bottom-nav {
  display: flex;
  align-items: stretch;
  margin: 0 8px calc(8px + env(safe-area-inset-bottom, 0px));
  border-radius: 18px;
  border: 1px solid var(--ms-border);
  background: var(--ms-surface-2);
  box-shadow: var(--ms-shadow-float);
  overflow: hidden;
}

.bottom-nav-btn {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 0 8px;
  border: none;
  background: transparent;
  color: var(--ms-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
  cursor: pointer;
  transition: color 0.16s ease;
}

/* Активная вкладка — только цветом: фон/подложка здесь лишние. */
.bottom-nav-btn.active {
  color: var(--ms-accent);
  font-weight: 600;
}

.bottom-nav-btn:hover {
  color: var(--ms-text-strong, var(--ms-text));
}

.bottom-nav-btn.active:hover {
  color: var(--ms-accent);
}

/* Точка «есть новое»: прижата к «пилюле» иконки, а не к краю кнопки. */
.bottom-nav-badge {
  position: absolute;
  top: 3px;
  right: calc(50% - 26px);
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  border-radius: 10px;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 19px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--ms-surface-2);
}

.bottom-nav-dot {
  position: absolute;
  top: 5px;
  right: calc(50% - 17px);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ms-accent);
  box-shadow: 0 0 0 2px var(--ms-surface);
}

@media (max-width: 380px) {
  .bottom-nav-btn {
    font-size: 10.5px;
    padding: 6px 0 7px;
  }
}
</style>
