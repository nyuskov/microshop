<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="ch-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="ch-title">Звонки</div>
        <q-space />
        <q-btn flat round dense :icon="icon('close')" aria-label="Закрыть" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <!-- Фильтры: «Пропущенные» — то, что чаще всего ищут (не ответил или
           отменил вызов). Ряд листается колесом, как чипы списка чатов. -->
      <div class="ch-filters" role="tablist" aria-label="Фильтр звонков">
        <button
          v-for="filter in CALL_FILTERS"
          :key="filter.key"
          class="ch-filter"
          :class="{ active: activeFilter === filter.key }"
          role="tab"
          :aria-selected="activeFilter === filter.key"
          @click="activeFilter = filter.key"
        >
          {{ filter.label }}
        </button>
      </div>

      <q-card-section class="ch-body">
        <p v-if="loading && !items.length" class="ch-status">Загружаем звонки…</p>
        <p v-else-if="error" class="ch-status error">{{ error }}</p>

        <EmptyState
          v-else-if="!visibleItems.length"
          icon="call"
          :title="activeFilter === 'missed' ? 'Пропущенных нет' : 'Звонков пока нет'"
          :hint="
            activeFilter === 'missed'
              ? 'Здесь появятся звонки, на которые вы не ответили.'
              : 'Позвоните собеседнику из шапки чата — звонок появится здесь.'
          "
        />

        <template v-else>
          <div v-for="(entry, index) in visibleItems" :key="entry.id">
            <!-- Разделитель дня считается по локальному времени: сервер отдаёт
                 UTC, а человек видит свои сутки. -->
            <div v-if="dayChanged(index)" class="ch-day">{{ callHistoryDay(entry) }}</div>
            <div class="ch-row" :class="{ missed: isMissedCall(entry) }">
              <span class="ch-avatar" :style="avatarStyle(callPeerName(entry))">
                <img
                  v-if="entry.peer?.avatar_thumb_url || entry.peer?.avatar_url"
                  :src="entry.peer.avatar_thumb_url ?? entry.peer.avatar_url ?? ''"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <template v-else>{{ initials(callPeerName(entry)) }}</template>
              </span>

              <button class="ch-main" type="button" @click="openChat(entry)">
                <span class="ch-name">{{ contactName(entry) }}</span>
                <span class="ch-line">
                  <q-icon :name="icon(callHistoryIcon(entry))" size="14px" />
                  <span>{{ callHistoryLabel(entry) }}</span>
                </span>
              </button>

              <span class="ch-time">{{ callHistoryTime(entry) }}</span>

              <!-- Перезвонить тем же типом, каким был звонок: для видеозвонка
                   сразу видео, для аудио — аудио. -->
              <button
                class="ch-call"
                type="button"
                :title="entry.call_kind === 'video' ? 'Перезвонить видео' : 'Перезвонить'"
                :aria-label="`Перезвонить: ${contactName(entry)}`"
                @click="emit('call-back', entry)"
              >
                <q-icon
                  :name="icon(entry.call_kind === 'video' ? 'videocam' : 'call')"
                  size="18px"
                />
              </button>
            </div>
          </div>

          <div v-if="items.length < total" class="ch-more">
            <q-btn
              flat
              no-caps
              dense
              color="primary"
              :loading="loading"
              label="Показать ещё"
              @click="loadMore"
            />
          </div>
        </template>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Экран «Звонки»: история звонков всех личных чатов.
 *
 * Зачем: в ленте чата запись о звонке — это системная строка, а чтобы найти «кто
 * звонил вчера и не ответил», приходилось открывать чаты по очереди. Здесь те же
 * записи собраны в одну ленту с фильтром «Пропущенные» и кнопкой «Перезвонить».
 *
 * Данные берём одним запросом (`GET /calls/history/`), страницами: записей может
 * быть много, а «Показать ещё» честно догружает следующую страницу.
 */
import { computed, onMounted, ref } from 'vue'

import EmptyState from '@/components/common/EmptyState.vue'
import { icon } from '@/utils/icons'
import { avatarStyle, initials } from '@/utils/user'
import { getErrorMessage } from '@/services/errors'
import { fetchCallHistory, CALL_HISTORY_PAGE } from '@/services/callHistory'
import { useContactsStore } from '@/stores/contacts'
import {
  CALL_FILTERS,
  callHistoryDay,
  callHistoryIcon,
  callHistoryLabel,
  callHistoryTime,
  callPeerName,
  filterCallHistory,
  isMissedCall,
  type CallFilterKey,
  type CallHistoryItem
} from '@/utils/callHistory'

const emit = defineEmits<{
  (e: 'close'): void
  /** Открыть чат звонка (карточка собеседника в списке). */
  (e: 'open-chat', item: CallHistoryItem): void
  /** Перезвонить собеседнику тем же типом звонка. */
  (e: 'call-back', item: CallHistoryItem): void
}>()

const contactsStore = useContactsStore()

const items = ref<CallHistoryItem[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const activeFilter = ref<CallFilterKey>('all')

const visibleItems = computed(() => filterCallHistory(items.value, activeFilter.value))

/** Имя собеседника с учётом локального прозвища контакта (видит только я). */
const contactName = (item: CallHistoryItem): string =>
  item.peer ? contactsStore.nameOf(item.peer.id) || callPeerName(item) : callPeerName(item)

/** Показывать ли разделитель дня перед записью (сравниваем с предыдущей). */
const dayChanged = (index: number): boolean => {
  const current = visibleItems.value[index]
  const previous = visibleItems.value[index - 1]
  if (!current) return false
  if (!previous) return true
  return callHistoryDay(current) !== callHistoryDay(previous)
}

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const page = await fetchCallHistory({ limit: CALL_HISTORY_PAGE, offset: 0 })
    items.value = page.items
    total.value = page.total
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось загрузить историю звонков')
  } finally {
    loading.value = false
  }
}

const loadMore = async () => {
  if (loading.value) return
  loading.value = true
  try {
    const page = await fetchCallHistory({
      limit: CALL_HISTORY_PAGE,
      offset: items.value.length
    })
    // Записи могут добавиться, пока листали: дубли отсекаем по id, иначе ключ
    // строки повторится и Vue нарисует две одинаковые.
    const known = new Set(items.value.map((item) => item.id))
    items.value = [...items.value, ...page.items.filter((item) => !known.has(item.id))]
    total.value = page.total
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось загрузить историю звонков')
  } finally {
    loading.value = false
  }
}

const openChat = (item: CallHistoryItem) => emit('open-chat', item)

onMounted(load)
</script>

<style scoped>
.ch-card {
  width: min(520px, 96vw);
  max-height: min(640px, 88vh);
  display: flex;
  flex-direction: column;
  background: var(--ms-surface);
  color: var(--ms-text);
  border-radius: 14px;
}

.ch-title {
  font-family: var(--ms-font-display);
  font-size: var(--ms-fs-lg);
}

/* Фильтры — отдельной строкой под заголовком, как чипы в списке чатов. */
.ch-filters {
  display: flex;
  gap: 6px;
  padding: 8px 12px 0;
}

.ch-filter {
  padding: 4px 10px;
  border: 1px solid var(--ms-border);
  border-radius: 999px;
  background: transparent;
  color: var(--ms-muted);
  font-size: var(--ms-fs-sm);
  cursor: pointer;
}

.ch-filter.active {
  border-color: var(--ms-accent);
  color: var(--ms-accent);
  background: var(--ms-surface-2);
}

/* Список прокручивается сам: карточка не должна расти на всю высоту экрана. */
.ch-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ch-status {
  margin: 8px 0;
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted);
}

.ch-status.error {
  color: var(--ms-danger);
}

.ch-day {
  margin: 8px 0 4px;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted-2);
}

.ch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 2px;
}

.ch-avatar {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: var(--ms-fs-sm);
  color: var(--ms-on-accent);
  background: var(--ms-muted-3);
}

.ch-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ch-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.ch-name {
  font-size: var(--ms-fs-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ch-line {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted);
}

/* Пропущенный звонок — красным: это то, что человек ищет в списке. */
.ch-row.missed .ch-line,
.ch-row.missed .ch-name {
  color: var(--ms-danger);
}

.ch-time {
  flex: none;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted-2);
}

.ch-call {
  flex: none;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ms-accent);
  cursor: pointer;
}

.ch-call:hover {
  background: var(--ms-surface-2);
}

.ch-more {
  display: flex;
  justify-content: center;
  padding: 6px 0;
}
</style>
