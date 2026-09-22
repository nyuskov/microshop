<template>
  <div class="inline-search">
    <q-icon :name="icon('search')" class="search-icon" size="17px" />
    <input
      v-model="query"
      class="inline-search-input"
      type="text"
      :placeholder="t('Поиск по сообщениям')"
      :aria-label="t('Поиск по сообщениям')"
      @keydown.enter.exact.prevent="emit('next')"
      @keydown.enter.shift.prevent="emit('prev')"
    />
    <!-- Счётчик «3 из 12»: видно, где мы среди найденных совпадений -->
    <span v-if="count > 0" class="inline-search-count" role="status">
      {{
        (current ?? 0) > 0
          ? t('{current} из {count}', { current: current ?? 0, count })
          : t('{count} {noun}', {
              count,
              noun: plural(count, ['совпадение', 'совпадения', 'совпадений'], ['match', 'matches'])
            })
      }}
    </span>
    <!-- Стрелки появляются только когда есть куда ходить -->
    <template v-if="count > 1">
      <button
        class="icon-btn"
        type="button"
        :title="t('Предыдущее (Shift+Enter)')"
        :aria-label="t('Предыдущее совпадение')"
        @click="emit('prev')"
      >
        <q-icon :name="icon('expand_less')" size="20px" />
      </button>
      <button
        class="icon-btn"
        type="button"
        :title="t('Следующее (Enter)')"
        :aria-label="t('Следующее совпадение')"
        @click="emit('next')"
      >
        <q-icon :name="icon('expand_more')" size="20px" />
      </button>
    </template>
    <button
      class="icon-btn"
      type="button"
      :title="t('Закрыть поиск')"
      :aria-label="t('Закрыть поиск')"
      @click="emit('close')"
    >
      <q-icon :name="icon('close')" size="20px" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { plural, t } from '@/i18n'

/**
 * Поиск по сообщениям внутри чата.
 *
 * Поиск серверный (по всей истории, а не только по загруженной порции), поэтому
 * строка сама ленту не фильтрует и не подсвечивает: она показывает, сколько
 * нашлось и на каком совпадении мы стоим, а переход делает родитель
 * (`next`/`prev`). Enter — следующее совпадение, Shift+Enter — предыдущее.
 */
const query = defineModel<string>('query', { required: true })

defineProps<{
  /** Сколько совпадений на сервере (0 — счётчик не показываем). */
  count: number
  /** Номер показанного совпадения, 1-based (0 — ещё никуда не переходили). */
  current?: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'prev'): void
  (e: 'next'): void
}>()
</script>

<style scoped>
.inline-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--ms-surface);
  border-bottom: 1px solid var(--ms-border);
}

.search-icon {
  color: var(--ms-muted-3);
  font-size: 0.9rem;
}

.inline-search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
  color: var(--ms-text);
}

.inline-search-count {
  flex: none;
  font-size: 12px;
  color: var(--ms-muted-2);
  white-space: nowrap;
}
</style>
