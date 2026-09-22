<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="folders-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="folders-title">{{ t('Папки чатов') }}</div>
        <q-space />
        <q-btn flat round dense icon="close" :aria-label="t('Закрыть')" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="folders-body">
        <p class="folders-hint">
          {{
            t(
              'Папка — свой список чатов с ручным порядком. Хранится на этом устройстве: на телефоне и на компьютере папки могут быть разными.'
            )
          }}
        </p>

        <!-- Список папок: клик раскрывает состав и правки. -->
        <ul v-if="props.folders.length" class="folder-list">
          <li v-for="folder in props.folders" :key="folder.id">
            <button
              class="folder-row"
              :class="{ active: folder.id === editingId }"
              type="button"
              :aria-expanded="folder.id === editingId"
              @click="toggleEditing(folder.id)"
            >
              <q-icon :name="icon('folder')" size="18px" aria-hidden="true" />
              <span class="folder-name">{{ folder.name }}</span>
              <span class="folder-count">{{ folder.chatIds.length }}</span>
              <q-icon
                :name="icon(folder.id === editingId ? 'expand_less' : 'chevron_right')"
                size="18px"
              />
            </button>

            <div v-if="folder.id === editingId" class="folder-editor">
              <label class="folder-field">
                <span class="sr-only">{{ t('Название папки') }}</span>
                <input
                  v-model="nameDraft"
                  type="text"
                  :maxlength="FOLDER_NAME_MAX"
                  :placeholder="t('Название папки')"
                  @keydown.enter.prevent="saveName(folder.id)"
                  @blur="saveName(folder.id)"
                />
              </label>

              <div v-if="folderChats.length" class="folder-chats">
                <div v-for="(chat, index) in folderChats" :key="chat.id" class="folder-chat">
                  <span class="folder-chat-name">{{ chatTitle(chat, props.currentUserId) }}</span>
                  <button
                    class="folder-icon-btn"
                    type="button"
                    :title="t('Выше')"
                    :disabled="index === 0"
                    @click="emit('move-chat', folder.id, chat.id, -1)"
                  >
                    <q-icon :name="icon('keyboard_arrow_up')" size="18px" />
                  </button>
                  <button
                    class="folder-icon-btn"
                    type="button"
                    :title="t('Ниже')"
                    :disabled="index === folderChats.length - 1"
                    @click="emit('move-chat', folder.id, chat.id, 1)"
                  >
                    <q-icon :name="icon('arrow_downward')" size="18px" />
                  </button>
                  <button
                    class="folder-icon-btn danger"
                    type="button"
                    :title="t('Убрать из папки')"
                    @click="emit('toggle-chat', folder.id, chat.id)"
                  >
                    <q-icon :name="icon('close')" size="18px" />
                  </button>
                </div>
              </div>
              <p v-else class="folder-empty">{{ t('В папке пока нет чатов.') }}</p>

              <button class="folder-add" type="button" @click="togglePicker(folder.id)">
                <q-icon :name="icon(pickerFor === folder.id ? 'expand_less' : 'add')" size="18px" />
                <span>{{ pickerFor === folder.id ? t('Скрыть список') : t('Добавить чаты') }}</span>
              </button>

              <div v-if="pickerFor === folder.id" class="folder-picker">
                <input
                  v-model="query"
                  class="folder-search"
                  type="search"
                  :placeholder="t('Поиск чата')"
                  :aria-label="t('Поиск чата для папки')"
                />
                <ul class="folder-candidates">
                  <li v-for="chat in candidates" :key="chat.id">
                    <label class="folder-candidate">
                      <input
                        type="checkbox"
                        :checked="isInside(folder, chat.id)"
                        @change="emit('toggle-chat', folder.id, chat.id)"
                      />
                      <span>{{ chatTitle(chat, props.currentUserId) }}</span>
                    </label>
                  </li>
                </ul>
                <p v-if="!candidates.length" class="folder-empty">{{ t('Ничего не найдено.') }}</p>
              </div>

              <button class="folder-delete" type="button" @click="removeFolder(folder.id)">
                <q-icon :name="icon('delete_outline')" size="18px" />
                <span>{{ t('Удалить папку') }}</span>
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="folder-empty">
          {{ t('Папок пока нет. Создайте первую — например, «Работа».') }}
        </p>

        <!-- Новая папка: сразу с чатами, если диалог открыли из меню чата. -->
        <form class="folder-new" @submit.prevent="addFolder">
          <input
            v-model="newName"
            type="text"
            :maxlength="FOLDER_NAME_MAX"
            :placeholder="t('Название новой папки')"
            :aria-label="t('Название новой папки')"
          />
          <button type="submit" :disabled="!newName.trim() || atLimit">
            <q-icon :name="icon('add')" size="18px" />
            <span>{{ t('Создать') }}</span>
          </button>
        </form>
        <p v-if="atLimit" class="folder-empty">
          {{
            t('Больше {count} папок не поместится в строку фильтров.', { count: MAX_CHAT_FOLDERS })
          }}
        </p>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { icon } from '@/utils/icons'
import type { Chat } from '@/types'
import { chatTitle } from '@/utils/user'
import { confirmDialog } from '@/utils/appDialogs'
import { t } from '@/i18n'
import {
  FOLDER_NAME_MAX,
  MAX_CHAT_FOLDERS,
  folderChats as folderChatsOf,
  type ChatFolder
} from '@/utils/chatFolders'

/**
 * Управление папками: создать, переименовать, собрать состав и расставить
 * порядок, удалить.
 *
 * Диалог ничего не хранит сам: папки приходят пропом, правки уходят событиями
 * в Messenger (там же живёт localStorage). Так у состояния один владелец, и его
 * не приходится синхронизировать между списком чатов и диалогом.
 *
 * «Сохранение на месте»: имя пишется по Enter и по уходу из поля — отдельной
 * кнопки «Сохранить» нет, а введённый текст не теряется.
 */
const props = defineProps<{
  folders: ChatFolder[]
  /** Все загруженные чаты — из них собираются состав и список кандидатов. */
  chats: Chat[]
  currentUserId: number | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create', name: string): void
  (e: 'rename', id: string, name: string): void
  (e: 'remove', id: string): void
  (e: 'toggle-chat', id: string, chatId: number): void
  (e: 'move-chat', id: string, chatId: number, delta: -1 | 1): void
}>()

/** Раскрытая папка (одна за раз: экран небольшой). */
const editingId = ref<string | null>(null)
const nameDraft = ref('')
/** Папка, у которой раскрыт список чатов для добавления. */
const pickerFor = ref<string | null>(null)
const query = ref('')
const newName = ref('')

const atLimit = computed(() => props.folders.length >= MAX_CHAT_FOLDERS)

const folderChats = computed<Chat[]>(() => {
  const folder = props.folders.find((item) => item.id === editingId.value)
  return folder ? folderChatsOf(folder, props.chats) : []
})

/** Чаты-кандидаты: всё, кроме «Сохранённых сообщений», с поиском по названию. */
const candidates = computed<Chat[]>(() => {
  const needle = query.value.trim().toLowerCase()
  return props.chats
    .filter((chat) => !chat.is_self)
    .filter(
      (chat) => !needle || chatTitle(chat, props.currentUserId).toLowerCase().includes(needle)
    )
})

const isInside = (folder: ChatFolder, chatId: number): boolean => folder.chatIds.includes(chatId)

const toggleEditing = (id: string) => {
  if (editingId.value === id) {
    editingId.value = null
    return
  }
  editingId.value = id
  pickerFor.value = null
  query.value = ''
  nameDraft.value = props.folders.find((folder) => folder.id === id)?.name ?? ''
}

/** Черновик имени подхватываем и при внешнем переименовании (список перерисовался). */
watch(
  () => props.folders.find((folder) => folder.id === editingId.value)?.name,
  (name) => {
    if (name !== undefined) nameDraft.value = name
  }
)

const saveName = (id: string) => {
  const name = nameDraft.value.trim()
  if (name && name !== props.folders.find((folder) => folder.id === id)?.name) {
    emit('rename', id, name)
  }
}

const togglePicker = (id: string) => {
  pickerFor.value = pickerFor.value === id ? null : id
  query.value = ''
}

const addFolder = () => {
  const name = newName.value.trim()
  if (!name || atLimit.value) return
  emit('create', name)
  newName.value = ''
}

/** Удаление с подтверждением: папка — результат ручной работы, терять жалко. */
const removeFolder = async (id: string) => {
  const folder = props.folders.find((item) => item.id === id)
  if (!folder) return
  const agreed = await confirmDialog({
    title: t('Удалить папку «{name}»?', { name: folder.name }),
    message: t('Чаты останутся на месте — удалится только сам список.'),
    okLabel: t('Удалить'),
    danger: true
  })
  if (!agreed) return
  editingId.value = null
  emit('remove', id)
}
</script>

<style scoped>
.folders-card {
  width: min(520px, 96vw);
  background: var(--ms-surface);
  color: var(--ms-text);
  border-radius: 14px;
}

.folders-title {
  font-family: var(--ms-font-display);
  font-size: var(--ms-fs-lg);
}

.folders-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: min(70vh, 620px);
  overflow-y: auto;
}

.folders-hint {
  margin: 0;
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted);
  line-height: 1.45;
}

.folder-list,
.folder-candidates {
  list-style: none;
  margin: 0;
  padding: 0;
}

.folder-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  background: var(--ms-surface-2);
  color: inherit;
  font: inherit;
  padding: 9px 10px;
  cursor: pointer;
  text-align: left;
}

.folder-row.active {
  border-color: var(--ms-accent);
}

.folder-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-count {
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted-2);
}

.folder-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 4px 4px;
}

.folder-field input,
.folder-search,
.folder-new input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--ms-border);
  border-radius: 9px;
  background: var(--ms-surface);
  color: inherit;
  font: inherit;
  padding: 8px 10px;
}

.folder-chats {
  display: flex;
  flex-direction: column;
}

.folder-chat {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  border-bottom: 1px solid var(--ms-border);
}

.folder-chat:last-child {
  border-bottom: none;
}

.folder-chat-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ms-fs-sm);
}

.folder-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ms-muted);
  cursor: pointer;
}

.folder-icon-btn:hover:not(:disabled) {
  background: var(--ms-hover);
  color: var(--ms-text);
}

.folder-icon-btn.danger:hover {
  color: var(--ms-danger);
}

.folder-icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.folder-add,
.folder-delete,
.folder-new button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--ms-border);
  border-radius: 9px;
  background: var(--ms-surface-2);
  color: inherit;
  font: inherit;
  font-size: var(--ms-fs-sm);
  padding: 7px 10px;
  cursor: pointer;
}

.folder-delete {
  align-self: flex-start;
  color: var(--ms-danger);
}

.folder-new {
  display: flex;
  gap: 8px;
}

.folder-new button {
  flex: none;
  border-color: var(--ms-accent-border);
  background: var(--ms-accent-soft);
}

.folder-new button:disabled {
  opacity: 0.5;
  cursor: default;
}

.folder-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.folder-candidates {
  max-height: 200px;
  overflow-y: auto;
}

.folder-candidate {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 2px;
  font-size: var(--ms-fs-sm);
  cursor: pointer;
}

.folder-empty {
  margin: 0;
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted-2);
}
</style>
