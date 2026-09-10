<template>
  <div class="pinned-bar" @click="emit('close-popups')">
    <q-icon :name="icon('push_pin')" class="pinned-icon" size="17px" />
    <div class="pinned-content">
      <div class="pinned-head">
        <span>Закреплённые сообщения</span>
        <span class="pinned-count">{{ rows.length }}</span>
      </div>
      <div v-if="open" class="pinned-list">
        <div
          v-for="item in rows"
          :key="item.id"
          class="pinned-item"
          role="button"
          tabindex="0"
          title="Перейти к сообщению"
          @click.stop="emit('scroll-to', item.id)"
          @keydown.enter.prevent="emit('scroll-to', item.id)"
          @keydown.space.prevent="emit('scroll-to', item.id)"
        >
          <span class="pinned-sender">{{ item.sender }}</span>
          {{ item.snippet }}
        </div>
      </div>
    </div>
    <button class="icon-btn" title="Развернуть" @click.stop="open = !open">
      <q-icon :name="icon('expand_more')" :class="{ rotated: open }" size="20px" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
interface PinnedRow {
  id: number
  sender: string
  snippet: string
}

defineProps<{
  rows: PinnedRow[]
}>()

const open = defineModel<boolean>('open', { default: true })

const emit = defineEmits<{
  (e: 'scroll-to', messageId: number): void
  (e: 'close-popups'): void
}>()
</script>

<style scoped>
.pinned-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 16px;
  background: #fffdf4;
  border-bottom: 1px solid #efe4c8;
}

.pinned-icon {
  color: #c9a227;
  font-size: 1rem;
  margin-top: 3px;
}

.pinned-content {
  flex: 1;
  min-width: 0;
}

.pinned-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #8a7320;
  font-weight: 600;
}

.pinned-count {
  background: #f3e6b8;
  color: #8a7320;
  border-radius: 10px;
  padding: 0 6px;
  font-size: 11px;
}

.pinned-item {
  font-size: 13.5px;
  color: #4a4a3c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 3px;
  padding: 4px 8px;
  border-radius: 8px;
  cursor: pointer;
}

.pinned-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.pinned-sender {
  font-weight: 600;
  color: #1e7a43;
  margin-right: 6px;
}

.rotated {
  transform: rotate(180deg);
}
</style>
