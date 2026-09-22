<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="picker-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="picker-title">{{ t('В папку') }}</div>
        <q-space />
        <q-btn flat round dense icon="close" :aria-label="t('Закрыть')" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="picker-body">
        <p class="picker-hint">
          {{
            t(
              '{target} — отметьте папки, где чат должен быть виден. Порядок внутри папки расставляется в «Папки чатов».',
              { target }
            )
          }}
        </p>

        <ul v-if="props.folders.length" class="picker-list" role="group" :aria-label="t('Папки')">
          <li v-for="folder in props.folders" :key="folder.id">
            <label class="picker-row">
              <input
                type="checkbox"
                :checked="inside(folder)"
                @change="emit('toggle', folder.id, !inside(folder))"
              />
              <q-icon :name="icon('folder')" size="18px" aria-hidden="true" />
              <span class="picker-name">{{ folder.name }}</span>
              <span class="picker-count">{{ folder.chatIds.length }}</span>
            </label>
          </li>
        </ul>
        <p v-else class="picker-empty">{{ t('Папок пока нет — создайте первую прямо здесь.') }}</p>

        <form class="picker-new" @submit.prevent="create">
          <input
            v-model="name"
            type="text"
            :maxlength="FOLDER_NAME_MAX"
            :placeholder="t('Новая папка')"
            :aria-label="t('Название новой папки')"
          />
          <button type="submit" :disabled="!name.trim() || atLimit">
            <q-icon :name="icon('add')" size="18px" />
            <span>{{ t('Создать') }}</span>
          </button>
        </form>

        <button class="picker-done" type="button" @click="emit('close')">{{ t('Готово') }}</button>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { icon } from '@/utils/icons'
import { FOLDER_NAME_MAX, MAX_CHAT_FOLDERS, type ChatFolder } from '@/utils/chatFolders'
import { t } from '@/i18n'

/**
 * Отметить папки для одного или нескольких чатов.
 *
 * Галочка применяется сразу (без «Сохранить»): человек видит результат в списке
 * чатов, а случайный лишний тап так же просто снять.
 */
const props = defineProps<{
  folders: ChatFolder[]
  /** Чаты, для которых открыт выбор (один — из меню чата, несколько — из выделения). */
  chatIds: number[]
  /** Подпись в подсказке: название чата или «3 чата». */
  target: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create', name: string): void
  (e: 'toggle', id: string, inside: boolean): void
}>()

const name = ref('')
const atLimit = computed(() => props.folders.length >= MAX_CHAT_FOLDERS)

/** Чат(ы) уже в папке: все выбранные чаты внутри (для галочки). */
const inside = (folder: ChatFolder): boolean =>
  props.chatIds.length > 0 && props.chatIds.every((id) => folder.chatIds.includes(id))

const create = () => {
  const value = name.value.trim()
  if (!value || atLimit.value) return
  emit('create', value)
  name.value = ''
}
</script>

<style scoped>
.picker-card {
  width: min(460px, 96vw);
  background: var(--ms-surface);
  color: var(--ms-text);
  border-radius: 14px;
}

.picker-title {
  font-family: var(--ms-font-display);
  font-size: var(--ms-fs-lg);
}

.picker-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.picker-hint {
  margin: 0;
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted);
  line-height: 1.45;
}

.picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  cursor: pointer;
}

.picker-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-count {
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted-2);
}

.picker-new {
  display: flex;
  gap: 8px;
}

.picker-new input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--ms-border);
  border-radius: 9px;
  background: var(--ms-surface-2);
  color: inherit;
  font: inherit;
  padding: 8px 10px;
}

.picker-new button,
.picker-done {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--ms-border);
  border-radius: 9px;
  background: var(--ms-surface-2);
  color: inherit;
  font: inherit;
  font-size: var(--ms-fs-sm);
  padding: 8px 12px;
  cursor: pointer;
}

.picker-new button {
  flex: none;
  border-color: var(--ms-accent-border);
  background: var(--ms-accent-soft);
}

.picker-new button:disabled {
  opacity: 0.5;
  cursor: default;
}

.picker-done {
  align-self: flex-end;
}

.picker-empty {
  margin: 0;
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted-2);
}
</style>
