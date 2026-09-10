<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="mod-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="text-subtitle1 text-weight-medium">Жалобы</div>
        <q-space />
        <q-btn flat round dense icon="refresh" aria-label="Обновить" @click="load" />
        <q-btn flat round dense icon="close" aria-label="Закрыть" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <div class="mod-tabs">
        <button
          v-for="tab in STATUS_TABS"
          :key="tab.value"
          class="mod-tab"
          :class="{ active: activeStatus === tab.value }"
          @click="activeStatus = tab.value"
        >
          {{ tab.label }}
        </button>
        <button class="mod-tab" :class="{ active: showJournal }" @click="toggleJournal">
          Журнал
        </button>
      </div>

      <q-card-section v-if="showJournal" class="mod-body">
        <p class="mod-hint">
          Журнал модерации: что и когда произошло с контентом — отправили жалобу, автомат скрыл
          сообщение после нескольких жалоб, модератор подтвердил нарушение или восстановил контент.
          Записи не меняются, поэтому на них можно ссылаться при разборе спорных случаев.
        </p>
        <p v-if="journalHidden !== null" class="mod-count">
          Скрыто сейчас: {{ journalHidden }} · записей в журнале: {{ journalTotal }}
        </p>
        <div v-if="journalLoading" class="mod-empty">Загрузка…</div>
        <div v-else-if="journal.length === 0" class="mod-empty">Журнал пуст.</div>
        <template v-else>
          <article v-for="entry in journal" :key="entry.id" class="mod-item">
            <header class="mod-item-head">
              <span class="mod-reason">{{ journalActionLabel(entry.action) }}</span>
              <span
                class="mod-status"
                :class="entry.moderator_id === null ? 's-new' : 's-in_review'"
              >
                {{
                  entry.moderator_id === null ? 'автоматика' : `модератор #${entry.moderator_id}`
                }}
              </span>
              <q-space />
              <span class="mod-date">{{ formatReportDate(entry.created_at) }}</span>
            </header>
            <p class="mod-muted">
              {{ entry.note }}
              <template v-if="entry.message_id"> · сообщение #{{ entry.message_id }}</template>
              <template v-if="entry.report_id"> · жалоба #{{ entry.report_id }}</template>
              <template v-if="entry.target_user_id"> · автор #{{ entry.target_user_id }} </template>
            </p>
            <div v-if="entry.target_user_id" class="mod-actions">
              <q-btn
                flat
                no-caps
                dense
                color="primary"
                label="Восстановить все сообщения автора"
                :loading="busyUnhide === entry.target_user_id"
                @click="restoreAuthorMessages(entry.target_user_id)"
              />
            </div>
          </article>
        </template>
        <p v-if="journalError" class="mod-error" role="alert">{{ journalError }}</p>
      </q-card-section>

      <q-card-section v-if="!showJournal" class="mod-body">
        <p class="mod-hint">
          Жалобы приходят из приложения: «Пожаловаться» в шапке диалога или в меню сообщения. Разбор
          нигде, кроме этой таблицы, не отображается — статус нужен, чтобы не разбирать одно дважды.
        </p>

        <div v-if="loading" class="mod-empty">Загрузка…</div>
        <div v-else-if="reports.length === 0" class="mod-empty">Жалоб в этом разделе нет.</div>
        <template v-else>
          <p class="mod-count">Всего: {{ total }}</p>
          <article v-for="report in reports" :key="report.id" class="mod-item">
            <header class="mod-item-head">
              <span class="mod-reason">{{ reportReasonLabel(report.reason) }}</span>
              <span class="mod-status" :class="`s-${report.status}`">
                {{ REPORT_STATUS_LABELS[report.status] }}
              </span>
              <q-space />
              <span class="mod-date">{{ formatReportDate(report.created_at) }}</span>
            </header>

            <p class="mod-pair">
              <strong>{{ report.reporter_name || `ID ${report.reporter_id}` }}</strong>
              <span class="mod-muted">{{ report.reporter_phone || '' }}</span>
              <q-icon :name="icon('arrow_forward')" size="14px" class="mod-arrow" />
              <strong>{{ report.reported_name || `ID ${report.reported_id}` }}</strong>
              <span class="mod-muted">{{ report.reported_phone || '' }}</span>
            </p>

            <p v-if="report.message_text" class="mod-quote">«{{ report.message_text }}»</p>
            <p v-else-if="report.message_id" class="mod-muted">
              Сообщение #{{ report.message_id }} (вложение или удалено)
            </p>
            <p class="mod-muted">
              Контекст: {{ contextLabel(report) }}
              {{ report.note ? ` · заметка: ${report.note}` : '' }}
            </p>

            <p v-if="report.comment" class="mod-comment">
              Комментарий: <span>{{ report.comment }}</span>
            </p>

            <div class="mod-actions">
              <input
                v-model="notes[report.id]"
                class="mod-note"
                type="text"
                maxlength="1000"
                placeholder="Заметка (необязательно)"
                :aria-label="`Заметка по жалобе ${report.id}`"
              />
              <q-btn
                v-for="action in ACTIONS"
                :key="action.status"
                flat
                no-caps
                dense
                :color="action.color"
                :label="action.label"
                :disable="report.status === action.status"
                :loading="busyId === report.id"
                @click="setStatus(report, action.status)"
              />
            </div>
          </article>
        </template>

        <p v-if="error" class="mod-error" role="alert">{{ error }}</p>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { onMounted, ref, watch } from 'vue'

import {
  JOURNAL_ACTION_LABELS,
  REPORT_STATUS_LABELS,
  fetchJournal,
  fetchReports,
  reportReasonLabel,
  unhideUserMessages,
  updateReportStatus,
  type ModerationJournalEntry,
  type ModerationReport,
  type ReportStatus
} from '@/services/moderation'
import { getErrorMessage } from '@/services/errors'

const emit = defineEmits<{
  (e: 'close'): void
}>()

/** Вкладки-фильтры по статусу разбора. */
const STATUS_TABS: { value: ReportStatus | 'all'; label: string }[] = [
  { value: 'new', label: 'Новые' },
  { value: 'in_review', label: 'В работе' },
  { value: 'resolved', label: 'Решённые' },
  { value: 'rejected', label: 'Отклонённые' },
  { value: 'all', label: 'Все' }
]

/** Кнопки смены статуса у карточки жалобы. */
const ACTIONS: { status: ReportStatus; label: string; color: string }[] = [
  { status: 'in_review', label: 'В работу', color: 'primary' },
  { status: 'resolved', label: 'Решена', color: 'positive' },
  { status: 'rejected', label: 'Отклонить', color: 'negative' }
]

const activeStatus = ref<ReportStatus | 'all'>('new')
const reports = ref<ModerationReport[]>([])
const total = ref(0)
const loading = ref(true)
const busyId = ref<number | null>(null)
const error = ref('')
/** Черновики заметок по id жалобы (заполняются сохранённой заметкой). */
const notes = ref<Record<number, string>>({})

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchReports({
      status: activeStatus.value === 'all' ? undefined : activeStatus.value,
      limit: 50
    })
    reports.value = data.items
    total.value = data.total
    for (const report of data.items) {
      notes.value[report.id] = report.note ?? ''
    }
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось загрузить жалобы')
  } finally {
    loading.value = false
  }
}

/** Смена статуса; при фильтре по статусу карточка уходит из списка. */
const setStatus = async (report: ModerationReport, status: ReportStatus) => {
  if (busyId.value !== null) return
  busyId.value = report.id
  error.value = ''
  try {
    const updated = await updateReportStatus(report.id, status, notes.value[report.id])
    notes.value[report.id] = updated.note ?? ''
    if (activeStatus.value !== 'all' && activeStatus.value !== updated.status) {
      reports.value = reports.value.filter((item) => item.id !== updated.id)
      total.value = Math.max(0, total.value - 1)
    } else {
      reports.value = reports.value.map((item) => (item.id === updated.id ? updated : item))
    }
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось изменить статус')
  } finally {
    busyId.value = null
  }
}

/** Дата жалобы в коротком виде (дд.мм чч:мм). */
const formatReportDate = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

/** Где произошло нарушение: чат и/или конкретное сообщение. */
const contextLabel = (report: ModerationReport): string => {
  const parts: string[] = []
  if (report.chat_id) parts.push(`чат #${report.chat_id}`)
  if (report.message_id) parts.push(`сообщение #${report.message_id}`)
  return parts.length > 0 ? parts.join(', ') : 'без чата (жалоба на профиль)'
}

watch(activeStatus, load)
onMounted(load)

// --- Журнал модерации (третья вкладка) ---
// Отдельный вид в том же окне: модератору нужно видеть и очередь жалоб, и след
// принятых решений (требование магазинов к разбору UGC).
const showJournal = ref(false)
const journal = ref<ModerationJournalEntry[]>([])
const journalTotal = ref(0)
const journalHidden = ref<number | null>(null)
const journalLoading = ref(false)
const journalError = ref('')
const busyUnhide = ref<number | null>(null)

const journalActionLabel = (action: string): string => JOURNAL_ACTION_LABELS[action] ?? action

const loadJournal = async () => {
  journalLoading.value = true
  journalError.value = ''
  try {
    const data = await fetchJournal({ limit: 100 })
    journal.value = data.items
    journalTotal.value = data.total
    journalHidden.value = data.hidden_messages
  } catch (err) {
    journalError.value = getErrorMessage(err, 'Не удалось загрузить журнал')
  } finally {
    journalLoading.value = false
  }
}

const toggleJournal = async () => {
  showJournal.value = !showJournal.value
  if (showJournal.value && journal.value.length === 0) {
    await loadJournal()
  }
}

/** Возврат контента автора после ложных жалоб (действие попадает в журнал). */
const restoreAuthorMessages = async (userId: number) => {
  if (busyUnhide.value !== null) return
  busyUnhide.value = userId
  journalError.value = ''
  try {
    await unhideUserMessages(userId)
    await loadJournal()
  } catch (err) {
    journalError.value = getErrorMessage(err, 'Не удалось восстановить сообщения')
  } finally {
    busyUnhide.value = null
  }
}
</script>

<style scoped>
.mod-card {
  width: min(720px, calc(100vw - 32px));
  border-radius: 18px;
}

.mod-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 16px 0;
}

.mod-tab {
  border: 1px solid var(--ms-border, #dfe5ea);
  background: transparent;
  color: var(--ms-text-muted, #6b7784);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
}

.mod-tab.active {
  border-color: var(--ms-accent);
  color: var(--ms-accent);
  background: var(--ms-accent-soft, rgba(0, 0, 0, 0.06));
}

.mod-body {
  max-height: 68vh;
  overflow: auto;
}

.mod-hint,
.mod-count {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ms-text-muted, #6b7784);
}

.mod-count {
  margin-bottom: 8px;
}

.mod-empty {
  padding: 22px 0;
  text-align: center;
  color: var(--ms-text-muted, #6b7784);
  font-size: 14px;
}

.mod-item {
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.mod-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mod-reason {
  font-size: 13px;
  font-weight: 600;
}

.mod-status {
  font-size: 11.5px;
  border-radius: 999px;
  padding: 2px 8px;
  background: var(--ms-surface-2, #eef1f4);
  color: var(--ms-text-muted, #6b7784);
}

.mod-status.s-new {
  color: #b26a00;
  background: rgba(255, 168, 0, 0.16);
}

.mod-status.s-resolved {
  color: #1a7f45;
  background: rgba(46, 162, 94, 0.16);
}

.mod-status.s-rejected {
  color: #b03030;
  background: rgba(214, 69, 69, 0.16);
}

.mod-date {
  font-size: 12px;
  color: var(--ms-text-muted, #6b7784);
}

.mod-pair {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 4px;
  font-size: 14px;
}

.mod-arrow {
  color: var(--ms-text-muted, #6b7784);
}

.mod-muted {
  color: var(--ms-text-muted, #6b7784);
  font-size: 12.5px;
  margin: 2px 0;
}

.mod-quote {
  margin: 6px 0;
  padding: 6px 10px;
  border-left: 3px solid var(--ms-border, #dfe5ea);
  font-size: 13.5px;
  white-space: pre-wrap;
  word-break: break-word;
}

.mod-comment {
  margin: 6px 0;
  font-size: 13.5px;
}

.mod-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.mod-note {
  flex: 1 1 200px;
  min-width: 0;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 8px;
  padding: 6px 9px;
  font-size: 13px;
  font-family: inherit;
  background: transparent;
  color: inherit;
}

.mod-error {
  margin: 10px 0 0;
  color: #d64545;
  font-size: 13px;
}
</style>
