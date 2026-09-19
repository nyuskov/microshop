<template>
  <!-- Шапка держит переключение между основными списками и быстрые действия. -->
  <!-- Режим выделения чатов (вход по удержанию) -->
  <div v-if="selectionMode" class="selection-bar">
    <button class="icon-btn" title="Отмена" @click="emit('exit-selection')">
      <q-icon :name="icon('close')" size="20px" />
    </button>
    <span class="selection-count">{{ selectedCount }}</span>
    <div class="selection-actions">
      <button
        class="icon-btn"
        :class="{ on: selectionAllMuted }"
        :title="selectionAllMuted ? 'Включить уведомления' : 'Замьютить выбранные'"
        aria-label="Мьют/анмьют выбранных"
        @click="emit('bulk-mute')"
      >
        <q-icon
          :name="icon(selectionAllMuted ? 'notifications' : 'notifications_off')"
          size="20px"
        />
      </button>
      <button
        class="icon-btn"
        :class="{ on: selectionAllPinned }"
        :title="selectionAllPinned ? 'Открепить выбранные' : 'Закрепить выбранные'"
        aria-label="Пин/анпин выбранных"
        @click="emit('bulk-pin')"
      >
        <q-icon :name="icon('push_pin')" size="20px" />
      </button>
      <button
        class="icon-btn"
        :class="{ on: selectionAllArchived }"
        :title="selectionAllArchived ? 'Убрать из архива' : 'В архив'"
        aria-label="В архив/из архива выбранных"
        @click="emit('bulk-archive')"
      >
        <q-icon :name="icon('archive')" size="20px" />
      </button>
      <button
        class="icon-btn"
        title="В папку"
        aria-label="Добавить выбранные чаты в папку"
        @click="emit('bulk-folders')"
      >
        <q-icon :name="icon('folder')" size="20px" />
      </button>
      <button
        class="icon-btn danger"
        title="Удалить выбранные"
        aria-label="Удалить выбранные"
        @click="emit('bulk-delete')"
      >
        <q-icon :name="icon('delete')" size="20px" />
      </button>
      <button
        class="icon-btn"
        :class="{ on: allVisibleSelected }"
        title="Выбрать все"
        aria-label="Выбрать все"
        @click="emit('toggle-select-all')"
      >
        <q-icon :name="icon('done_all')" size="20px" />
      </button>
    </div>
  </div>

  <div v-else class="panel-header">
    <!-- Истории: сжатый ряд кружков рядом со значком приложения. Кликабельность
         видна по зелёному ореолу, нажатие раскрывает полосу под шапкой;
         в раскрытом состоянии кружок подсвечен. -->
    <StoriesStrip
      v-if="view === 'chats'"
      mini
      :expanded="expanded"
      @toggle-expand="emit('toggle-stories-expand')"
      @open-story="emit('open-story', $event)"
    />

    <div class="panel-header-right">
      <button
        v-if="view === 'chats'"
        class="icon-btn"
        title="Контакты"
        aria-label="Открыть контакты"
        @click="emit('to-contacts')"
      >
        <q-icon :name="icon('group')" size="20px" />
      </button>
      <button
        v-else
        class="icon-btn"
        title="Чаты"
        aria-label="Открыть чаты"
        @click="emit('to-chats')"
      >
        <q-icon :name="icon('forum')" size="20px" />
      </button>
      <button
        v-if="view === 'chats'"
        class="icon-btn"
        :class="{ open: searchOpen }"
        :title="searchOpen ? 'Закрыть поиск' : 'Поиск'"
        :aria-label="searchOpen ? 'Закрыть поиск' : 'Поиск'"
        @click="emit('toggle-search')"
      >
        <q-icon :name="icon('search')" size="20px" />
      </button>
      <button
        v-if="view === 'contacts'"
        class="icon-btn"
        title="Добавить из контактов телефона"
        aria-label="Добавить из контактов телефона"
        @click="emit('add-from-phone')"
      >
        <q-icon :name="icon('contacts')" size="20px" />
      </button>
      <span ref="menuWrapEl" class="ms-dropdown-wrap" @click.stop>
        <button
          class="icon-btn"
          :class="{ open: settingsMenuOpen }"
          title="Ещё"
          aria-label="Ещё"
          @click="toggleSettingsMenu"
        >
          <q-icon :name="icon('more_vert')" size="20px" />
        </button>
        <div v-if="settingsMenuOpen" class="ms-dropdown">
          <button
            v-for="action in settingsActions"
            :key="action.key"
            class="ms-dropdown-item"
            @click="runSettingsAction(action)"
          >
            <q-icon :name="icon(action.icon)" size="19px" />
            <span>{{ action.label }}</span>
          </button>
        </div>
      </span>
      <button
        class="self-profile-btn"
        title="Настройки профиля"
        aria-label="Настройки профиля"
        @click="emit('open-profile')"
      >
        <span class="avatar self-avatar" :style="avatarStyle(selfName)">
          <img
            v-if="selfAvatarUrl"
            :src="selfAvatarUrl"
            class="avatar-img"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <template v-else>{{ selfName ? initials(selfName) : 'U' }}</template>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { icon } from '@/utils/icons'
import { avatarStyle, initials } from '@/utils/user'
import StoriesStrip from '@/components/stories/StoriesStrip.vue'

export interface SettingsAction {
  key: 'calls' | 'group' | 'channel' | 'blocked'
  label: string
  icon: string
}

const props = defineProps<{
  selectionMode: boolean
  selectedCount: number
  selectionAllMuted: boolean
  selectionAllPinned: boolean
  selectionAllArchived: boolean
  allVisibleSelected: boolean
  view: 'chats' | 'contacts'
  expanded: boolean
  searchOpen: boolean
  selfName: string
  selfAvatarUrl?: string
}>()

const emit = defineEmits<{
  (e: 'exit-selection'): void
  (e: 'bulk-mute'): void
  (e: 'bulk-pin'): void
  (e: 'bulk-archive'): void
  /** Добавить выбранные чаты в папку (открывает выбор папок). */
  (e: 'bulk-folders'): void
  (e: 'bulk-delete'): void
  (e: 'toggle-select-all'): void
  (e: 'toggle-stories-expand'): void
  (e: 'open-story', storyId: number): void
  (e: 'toggle-search'): void
  (e: 'add-from-phone'): void
  (e: 'to-contacts'): void
  (e: 'to-chats'): void
  (e: 'open-profile'): void
  (e: 'open-calls'): void
  (e: 'create-group'): void
  (e: 'create-channel'): void
  (e: 'open-blocked'): void
}>()

/** Обёртка меню «⋯» (кнопка + выпадающий список) — по ней считаем «клик мимо». */
const menuWrapEl = ref<HTMLElement | null>(null)
const settingsMenuOpen = ref(false)

const toggleSettingsMenu = () => {
  settingsMenuOpen.value = !settingsMenuOpen.value
}

// Пункты верхнего меню «⋯». Служебные разделы (разбор жалоб и т.п.) здесь
// больше не живут: они собраны в админской «шестерёнке» внизу панели.
const settingsActions = computed<SettingsAction[]>(() => [
  // «Звонки» — первым: это то, что человек ищет чаще, чем создание новых сущностей.
  { key: 'calls', label: 'Звонки', icon: 'call' },
  { key: 'group', label: 'Новая группа', icon: 'group_add' },
  { key: 'channel', label: 'Новый канал', icon: 'campaign' },
  { key: 'blocked', label: 'Заблокированные', icon: 'block' }
])

const runSettingsAction = (action: SettingsAction) => {
  settingsMenuOpen.value = false
  if (action.key === 'calls') emit('open-calls')
  if (action.key === 'group') emit('create-group')
  if (action.key === 'channel') emit('create-channel')
  if (action.key === 'blocked') emit('open-blocked')
}

// Тап/клик мимо меню закрывает «⋯».
// ВАЖНО: «мимо» считаем относительно самого меню, а не всей панели: на телефоне
// панель занимает весь экран, и тап «в сторону» попадал ВНУТРЬ панели — меню
// не закрывалось (выглядело как «залипло»).
let outsideHandler: ((event: PointerEvent) => void) | null = null
watch(settingsMenuOpen, (open) => {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
  if (open) {
    outsideHandler = (event: PointerEvent) => {
      const wrap = menuWrapEl.value
      if (wrap && !wrap.contains(event.target as Node)) settingsMenuOpen.value = false
    }
    document.addEventListener('pointerdown', outsideHandler)
  }
})

// Закрываем меню при смене вкладки или переходе в режим выделения.
watch([() => props.view, () => props.selectionMode], () => {
  settingsMenuOpen.value = false
})

onBeforeUnmount(() => {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
})
</script>

<style scoped>
/* ---------- Заголовки панелей ---------- */
.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 4px;
  background: var(--ms-surface);
}

.panel-header-right {
  display: flex;
  gap: 2px;
  /* Правая группа иконок прижата к краю: слева — значок приложения и истории. */
  margin-left: auto;
}

.icon-btn.open,
.icon-btn.on {
  color: var(--ms-accent);
}

/* Кнопка «Профиль»: вместо иконки показываем мини-аватар пользователя.
   Размер — как у иконки «Информация о чате» в шапке чата (40px). */
.self-profile-btn {
  background: none;
  border: none;
  padding: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.self-profile-btn:hover {
  background: var(--ms-hover, #f2f4f6);
}

/* Размер задаём через родителя: собственное правило `.self-avatar` имеет ту же
   специфичность, что и `.ms-rows .avatar` из assets/rows.css, и при переносе
   общих стилей проиграло бы ему по порядку подключения — значок профиля
   раздувался до размера аватара строки чата (46px).
   padding-top — оптическая центровка: прописные инициалы без строчных букв
   сидят выше центра, потому что строка центрируется с запасом под выносные
   элементы. Сдвиг равен отступу (box-sizing — чтобы круг остался 40px). */
.self-profile-btn .self-avatar {
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  padding-top: 2px;
  font-size: 0.9rem;
}

/* Dropdown-меню «⋯» */
.ms-dropdown-wrap {
  position: relative;
  display: inline-flex;
}

.ms-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: var(--ms-surface);
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-lg);
  box-shadow: var(--ms-shadow-pop);
  padding: 6px;
  z-index: 120;
  display: flex;
  flex-direction: column;
}

.ms-dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 9px 12px;
  border-radius: var(--ms-radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  font-family: inherit;
  color: var(--ms-text);
  white-space: nowrap;
}

.ms-dropdown-item:hover {
  background: var(--ms-hover);
}

.ms-dropdown-item i {
  width: 18px;
  text-align: center;
  font-size: 1rem;
  color: var(--ms-icon-2);
}

.ms-dropdown-item .q-icon {
  width: 18px;
  text-align: center;
  color: var(--ms-icon-2);
}

/* ---------- Режим выделения чатов (вход по удержанию) ---------- */
.selection-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #ffffff);
}

.selection-count {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.selection-actions .icon-btn.danger {
  color: var(--ms-danger, #d64545);
}
</style>
