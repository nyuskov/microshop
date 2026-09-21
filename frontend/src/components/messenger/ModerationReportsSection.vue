<template>
  <div class="mod-section">
    <div class="mod-bar">
      <div class="mod-tabs">
        <button
          v-for="tab in STATUS_TABS"
          :key="tab.value"
          class="mod-tab"
          :class="{ active: activeStatus === tab.value }"
          @click="activeStatus = tab.value"
        >
          {{ t(tab.label) }}
        </button>
        <button class="mod-tab" :class="{ active: showJournal }" @click="toggleJournal">
          {{ t('Журнал') }}
        </button>
      </div>
      <button
        type="button"
        class="mod-refresh"
        :title="t('Обновить')"
        :aria-label="t('Обновить')"
        @click="reload"
      >
        <q-icon :name="icon('refresh')" size="18px" />
      </button>
    </div>

    <div v-if="showJournal" class="mod-body">
      <p class="mod-hint">
        {{
          t(
            'Журнал модерации: что и когда произошло с контентом — отправили жалобу, автомат скрыл сообщение после нескольких жалоб, модератор подтвердил нарушение или восстановил контент. Записи не меняются, поэтому на них можно ссылаться при разборе спорных случаев.'
          )
        }}
      </p>
      <p v-if="journalHidden !== null" class="mod-count">
        {{
          t('Скрыто сейчас: {hidden} · записей в журнале: {total}', {
            hidden: journalHidden,
            total: journalTotal
          })
        }}
      </p>
      <div v-if="journalLoading" class="mod-empty">{{ t('Загрузка…') }}</div>
      <div v-else-if="journal.length === 0" class="mod-empty">{{ t('Журнал пуст.') }}</div>
      <template v-else>
        <article v-for="entry in journal" :key="entry.id" class="mod-item">
          <header class="mod-item-head">
            <span class="mod-reason">{{ journalActionLabel(entry.action) }}</span>
            <span class="mod-status" :class="entry.moderator_id === null ? 's-new' : 's-in_review'">
              {{
                entry.moderator_id === null
                  ? t('автоматика')
                  : t('модератор #{id}', { id: entry.moderator_id })
              }}
            </span>
            <q-space />
            <span class="mod-date">{{ formatReportDate(entry.created_at) }}</span>
          </header>
          <p class="mod-muted">
            {{ entry.note }}
            <template v-if="entry.message_id">
              · {{ t('сообщение #{id}', { id: entry.message_id }) }}
            </template>
            <template v-if="entry.report_id">
              · {{ t('жалоба #{id}', { id: entry.report_id }) }}
            </template>
            <template v-if="entry.target_user_id">
              · {{ t('автор #{id}', { id: entry.target_user_id }) }}
            </template>
          </p>
          <div v-if="entry.target_user_id" class="mod-actions">
            <q-btn
              flat
              no-caps
              dense
              color="primary"
              :label="t('Восстановить все сообщения автора')"
              :loading="busyUnhide === entry.target_user_id"
              @click="restoreAuthorMessages(entry.target_user_id)"
            />
          </div>
        </article>
      </template>
      <p v-if="journalError" class="mod-error" role="alert">{{ journalError }}</p>
    </div>

    <div v-else class="mod-body">
      <p class="mod-hint">
        {{
          t(
            'Жалобы приходят из приложения: «Пожаловаться» в шапке диалога или в меню сообщения. Разбор нигде, кроме этой таблицы, не отображается — статус нужен, чтобы не разбирать одно дважды.'
          )
        }}
      </p>

      <div v-if="loading" class="mod-empty">{{ t('Загрузка…') }}</div>
      <div v-else-if="reports.length === 0" class="mod-empty">
        {{ t('Жалоб в этом разделе нет.') }}
      </div>
      <template v-else>
        <p class="mod-count">{{ t('Всего: {total}', { total }) }}</p>
        <article v-for="report in reports" :key="report.id" class="mod-item">
          <header class="mod-item-head">
            <span class="mod-reason">{{ t(reportReasonLabel(report.reason)) }}</span>
            <span class="mod-status" :class="`s-${report.status}`">
              {{ t(REPORT_STATUS_LABELS[report.status]) }}
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
            {{ t('Сообщение #{id} (вложение или удалено)', { id: report.message_id }) }}
          </p>
          <p class="mod-muted">
            {{ t('Контекст: {context}', { context: contextLabel(report) }) }}
            {{ report.note ? t(' · заметка: {note}', { note: report.note }) : '' }}
          </p>

          <p v-if="report.comment" class="mod-comment">
            {{ t('Комментарий:') }} <span>{{ report.comment }}</span>
          </p>

          <div class="mod-actions">
            <input
              v-model="notes[report.id]"
              class="mod-note"
              type="text"
              maxlength="1000"
              :placeholder="t('Заметка (необязательно)')"
              :aria-label="t('Заметка по жалобе {id}', { id: report.id })"
            />
            <q-btn
              v-for="action in ACTIONS"
              :key="action.status"
              flat
              no-caps
              dense
              :color="action.color"
              :label="t(action.label)"
              :disable="report.status === action.status"
              :loading="busyId === report.id"
              @click="setStatus(report, action.status)"
            />
          </div>
        </article>
      </template>

      <p v-if="error" class="mod-error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Раздел настроек «Жалобы»: очередь разбора и журнал модерации.
 *
 * Раньше это было отдельное модальное окно (`ModerationReportsDialog.vue`),
 * которое открывалось из служебного экрана и закрывало настройки: после закрытия
 * человек оказывался в чате — «из жалоб назад дороги нет» (жалоба владельца).
 * Теперь раздел живёт ВНУТРИ настроек, как «Технические работы»: своя шапка с
 * кнопкой назад и общая прокрутка профиля.
 */
import { icon } from '@/utils/icons'
import { onMounted, ref, watch } from 'vue'
import { dateLocale, t } from '@/i18n'

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
import { parseServerTime } from '@/utils/format'

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
    error.value = getErrorMessage(err, t('Не удалось загрузить жалобы'))
  } finally {
    loading.value = false
  }
}

/** Кнопка «Обновить»: перечитываем то, что открыто сейчас (список или журнал). */
const reload = async () => {
  if (showJournal.value) await loadJournal()
  else await load()
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
    error.value = getErrorMessage(err, t('Не удалось изменить статус'))
  } finally {
    busyId.value = null
  }
}

/** Дата жалобы в коротком виде (дд.мм чч:мм). */
const formatReportDate = (iso: string): string =>
  new Date(parseServerTime(iso)).toLocaleString(dateLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

/** Где произошло нарушение: чат и/или конкретное сообщение. */
const contextLabel = (report: ModerationReport): string => {
  const parts: string[] = []
  if (report.chat_id) parts.push(t('чат #{id}', { id: report.chat_id }))
  if (report.message_id) parts.push(t('сообщение #{id}', { id: report.message_id }))
  return parts.length > 0 ? parts.join(', ') : t('без чата (жалоба на профиль)')
}

watch(activeStatus, load)
onMounted(load)

// --- Журнал модерации (третья вкладка) ---
// Отдельный вид в том же разделе: модератору нужно видеть и очередь жалоб, и след
// принятых решений (требование магазинов к разбору UGC).
const showJournal = ref(false)
const journal = ref<ModerationJournalEntry[]>([])
const journalTotal = ref(0)
const journalHidden = ref<number | null>(null)
const journalLoading = ref(false)
const journalError = ref('')
const busyUnhide = ref<number | null>(null)

const journalActionLabel = (action: string): string => t(JOURNAL_ACTION_LABELS[action] ?? action)

const loadJournal = async () => {
  journalLoading.value = true
  journalError.value = ''
  try {
    const data = await fetchJournal({ limit: 100 })
    journal.value = data.items
    journalTotal.value = data.total
    journalHidden.value = data.hidden_messages
  } catch (err) {
    journalError.value = getErrorMessage(err, t('Не удалось загрузить журнал'))
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
    journalError.value = getErrorMessage(err, t('Не удалось восстановить сообщения'))
  } finally {
    busyUnhide.value = null
  }
}
</script>

<style scoped>
.mod-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
}

.mod-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mod-tab {
  border: 1px solid var(--ms-border, #dfe5ea);
  background: transparent;
  color: var(--ms-muted);
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

/* Обновление — иконка справа от вкладок: раздел прокручивается вместе с
   настройками, своей шапки у него нет (она у профиля). */
.mod-refresh {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 50%;
  background: transparent;
  color: var(--ms-icon);
  cursor: pointer;
}

.mod-refresh:hover {
  background: var(--ms-hover);
}

.mod-hint,
.mod-count {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ms-muted);
}

.mod-count {
  margin-bottom: 8px;
}

.mod-empty {
  padding: 22px 0;
  text-align: center;
  color: var(--ms-muted);
  font-size: 14px;
}

.mod-item {
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: var(--ms-radius-md, 12px);
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
  font-size: var(--ms-fs-xs);
  border-radius: 999px;
  padding: 2px 8px;
  background: var(--ms-surface-2, #eef1f4);
  color: var(--ms-muted);
}

.mod-status.s-new {
  color: var(--ms-warn);
  background: var(--ms-warn-bg);
}

.mod-date {
  font-size: 12px;
  color: var(--ms-muted);
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
  color: var(--ms-muted-3);
}

.mod-muted {
  color: var(--ms-muted);
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
  border-radius: var(--ms-radius-sm, 10px);
  padding: 6px 9px;
  font-size: 13px;
  font-family: inherit;
  background: transparent;
  color: inherit;
}

.mod-error {
  margin: 10px 0 0;
  color: var(--ms-danger);
  font-size: 13px;
}
</style>
