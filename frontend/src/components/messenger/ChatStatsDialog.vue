<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="stats-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="stats-title">{{ t('Статистика чата') }}</div>
        <q-space />
        <q-btn flat round dense icon="close" :aria-label="t('Закрыть')" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="stats-body">
        <p v-if="loading" class="stats-status">{{ t('Считаем сообщения…') }}</p>
        <p v-else-if="error" class="stats-status error">{{ error }}</p>
        <template v-else-if="stats">
          <div class="stats-totals">
            <div class="total">
              <span class="total-value">{{ stats.messages_total }}</span>
              <span class="total-label">{{
                plural(
                  stats.messages_total,
                  ['сообщение', 'сообщения', 'сообщений'],
                  ['message', 'messages']
                )
              }}</span>
            </div>
            <p v-if="period" class="stats-period">{{ period }}</p>
          </div>

          <!-- Активность по дням: 30 столбиков, включая дни без сообщений -->
          <section class="stats-block">
            <div class="block-head">
              <h3 class="block-title">{{ t('Активность за 30 дней') }}</h3>
              <span v-if="average" class="block-hint">
                {{ t('в среднем {average} в активный день', { average }) }}
              </span>
            </div>
            <div class="bars" role="img" :aria-label="barsLabel">
              <span
                v-for="bar in bars"
                :key="bar.date"
                class="bar"
                :title="bar.title"
                :style="{ height: `${bar.heightPercent}%` }"
                :class="{ empty: bar.count === 0 }"
              ></span>
            </div>
            <div class="bars-axis">
              <span>{{ barsAxis.start }}</span>
              <span>{{ barsAxis.end }}</span>
            </div>
          </section>

          <!-- Кто активнее: полоска — доля от самого пишущего участника -->
          <section v-if="stats.top_senders.length" class="stats-block">
            <h3 class="block-title">{{ t('Кто пишет') }}</h3>
            <ul class="senders">
              <li v-for="sender in stats.top_senders" :key="sender.user_id" class="sender">
                <span class="sender-name">{{ sender.name || t('Участник') }}</span>
                <span class="sender-bar">
                  <span
                    class="sender-fill"
                    :style="{ width: `${senderShare(sender.count, stats.top_senders)}%` }"
                  ></span>
                </span>
                <span class="sender-count">{{ sender.count }}</span>
              </li>
            </ul>
          </section>

          <!-- Вложения: как во вкладках галереи чата -->
          <section class="stats-block">
            <h3 class="block-title">{{ t('Вложения') }}</h3>
            <div class="media-grid">
              <div v-for="tile in mediaTiles" :key="tile.kind" class="media-tile">
                <q-icon :name="icon(tile.icon)" size="18px" aria-hidden="true" />
                <span class="media-count">{{ tile.count }}</span>
                <span class="media-label">{{ t(tile.label) }}</span>
              </div>
            </div>
          </section>
        </template>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { fetchChatStats, type ChatStats } from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'
import { icon } from '@/utils/icons'
import { dailyAverage, senderShare, statsBars, statsPeriod } from '@/utils/chatStats'
import { parseServerTime } from '@/utils/format'
import { dateLocale, plural, t } from '@/i18n'

/**
 * «Статистика чата»: сколько писали, когда, кто активнее и что за вложения.
 *
 * Всё считается на сервере одним запросом (агрегаты уже есть в БД), а клиент
 * только раскладывает дни по календарю устройства — см. `utils/chatStats.ts`.
 */
const props = defineProps<{ chatId: number }>()

const emit = defineEmits<{ (e: 'close'): void }>()

const stats = ref<ChatStats | null>(null)
const loading = ref(true)
const error = ref('')

const bars = computed(() => (stats.value ? statsBars(stats.value.days) : []))
const average = computed(() => (stats.value ? dailyAverage(stats.value.days) : 0))
const period = computed(() =>
  stats.value ? statsPeriod(stats.value.first_at, stats.value.last_at) : ''
)

const barsAxis = computed(() => {
  const first = bars.value[0]
  const last = bars.value[bars.value.length - 1]
  const format = (iso: string): string =>
    parseServerTime(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
  return {
    start: first ? format(first.date) : '',
    end: last ? format(last.date) : ''
  }
})

/** Подпись графика для скринридера: числами, а не «картинкой». */
const barsLabel = computed(() => {
  const total = bars.value.reduce((sum, bar) => sum + bar.count, 0)
  return t('Сообщений за 30 дней: {count}', { count: total })
})

const mediaTiles = computed(() => {
  const media = stats.value?.media
  return [
    { kind: 'image', icon: 'image', label: 'Фото', count: media?.image ?? 0 },
    { kind: 'video', icon: 'videocam', label: 'Видео', count: media?.video ?? 0 },
    { kind: 'audio', icon: 'mic', label: 'Голосовые', count: media?.audio ?? 0 },
    { kind: 'file', icon: 'attach_file', label: 'Файлы', count: media?.file ?? 0 }
  ]
})

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    stats.value = await fetchChatStats(props.chatId)
  } catch (err) {
    stats.value = null
    error.value = getErrorMessage(err, t('Не удалось загрузить статистику'))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.stats-card {
  width: min(520px, 94vw);
  background: var(--ms-surface);
  color: var(--ms-text);
  border-radius: 14px;
}

.stats-title {
  font-family: var(--ms-font-display);
  font-size: var(--ms-fs-lg);
}

.stats-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.stats-status {
  margin: 0;
  color: var(--ms-muted-2);
  font-size: var(--ms-fs-base);
}

.stats-status.error {
  color: var(--ms-danger);
}

.stats-totals {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.total {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.total-value {
  font-family: var(--ms-font-display);
  font-size: 32px;
  font-variant-numeric: tabular-nums;
}

.total-label {
  color: var(--ms-muted-2);
  font-size: var(--ms-fs-base);
}

.stats-period {
  margin: 0;
  color: var(--ms-muted-3);
  font-size: var(--ms-fs-sm);
}

.stats-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.block-title {
  margin: 0;
  font-family: var(--ms-font-display);
  font-size: var(--ms-fs-base);
}

.block-hint {
  color: var(--ms-muted-3);
  font-size: var(--ms-fs-xs);
}

/* График: столбики растут снизу, высота — доля от самого активного дня. */
.bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 96px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--ms-border);
}

.bar {
  flex: 1;
  min-width: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--ms-accent);
  opacity: 0.85;
}

.bar.empty {
  height: 2px !important;
  background: var(--ms-border);
  opacity: 1;
}

.bars-axis {
  display: flex;
  justify-content: space-between;
  color: var(--ms-muted-3);
  font-size: var(--ms-fs-xs);
}

.senders {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sender {
  display: grid;
  grid-template-columns: minmax(90px, 34%) 1fr auto;
  align-items: center;
  gap: 8px;
}

.sender-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ms-fs-base);
}

.sender-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--ms-surface-2);
  overflow: hidden;
}

.sender-fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--ms-accent);
}

.sender-count {
  font-size: var(--ms-fs-sm);
  font-variant-numeric: tabular-nums;
  color: var(--ms-muted-2);
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.media-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 6px;
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  background: var(--ms-surface);
  color: var(--ms-muted-2);
}

.media-count {
  font-family: var(--ms-font-display);
  font-size: var(--ms-fs-lg);
  color: var(--ms-text);
  font-variant-numeric: tabular-nums;
}

.media-label {
  font-size: var(--ms-fs-xs);
}

@media (max-width: 420px) {
  .media-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
