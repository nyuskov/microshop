<template>
  <div class="inline-search">
    <q-icon :name="icon('search')" class="search-icon" size="17px" />
    <input
      v-model="query"
      class="inline-search-input"
      type="text"
      placeholder="Поиск по сообщениям"
      aria-label="Поиск по сообщениям"
    />
    <span v-if="count > 0" class="inline-search-count">{{ count }} совп.</span>
    <button class="icon-btn" title="Закрыть поиск" @click="emit('close')">
      <q-icon :name="icon('close')" size="20px" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
const query = defineModel<string>('query', { required: true })

defineProps<{
  /** Количество совпадений на сервере (0 — не показываем счётчик). */
  count: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<style scoped>
.inline-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #ffffff;
  border-bottom: 1px solid #e2e6ea;
}

.search-icon {
  color: #8595a2;
  font-size: 0.9rem;
}

.inline-search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
}

.inline-search-count {
  flex: none;
  font-size: 12px;
  color: #8a94a6;
  white-space: nowrap;
}
</style>
