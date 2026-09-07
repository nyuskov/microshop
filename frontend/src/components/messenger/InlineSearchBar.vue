<template>
  <div class="inline-search">
    <i class="pi pi-search search-icon"></i>
    <input
      v-model="query"
      class="inline-search-input"
      type="text"
      placeholder="Поиск по сообщениям"
      aria-label="Поиск по сообщениям"
    />
    <span v-if="count > 0" class="inline-search-count">{{ count }} совп.</span>
    <button class="icon-btn" title="Закрыть поиск" @click="emit('close')">
      <i class="pi pi-times"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
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

.icon-btn {
  background: none;
  border: none;
  color: #52626f;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  cursor: pointer;
}

.icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #202b34;
}
</style>
