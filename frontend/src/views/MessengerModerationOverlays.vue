<template>
  <!-- Модерация: жалоба на контент и список заблокированных (требования RuStore) -->
  <ReportDialog
    v-if="reportTarget"
    :user-id="reportTarget.userId"
    :user-name="reportTarget.userName"
    :chat-id="reportTarget.chatId"
    :message-id="reportTarget.messageId"
    :message-preview="reportTarget.messagePreview"
    @close="reportTarget = null"
    @sent="emit('sent')"
  />
  <BlockedUsersDialog
    v-if="showBlockedUsers"
    @close="showBlockedUsers = false"
    @unblocked="emit('blockedChanged')"
  />
  <!-- Разбор жалоб — только у администраторов (пункт «⋯» появляется им одним) -->
  <ModerationReportsDialog v-if="showReports && isAdmin" @close="showReports = false" />
</template>

<script setup lang="ts">
/**
 * Диалоги модерации: жалоба на пользователя/сообщение (RuStore требует такую
 * возможность), список заблокированных и служебный разбор жалоб.
 *
 * Кого именно жалуем, решает представление: оно владеет открытым чатом и
 * лентой — сюда приходит уже готовый объект жалобы. Наружу уходят только
 * последствия: жалоба отправлена и блокировка снята.
 */
import { defineAsyncComponent, ref } from 'vue'

const ReportDialog = defineAsyncComponent(() => import('@/components/messenger/ReportDialog.vue'))
const BlockedUsersDialog = defineAsyncComponent(
  () => import('@/components/messenger/BlockedUsersDialog.vue')
)
const ModerationReportsDialog = defineAsyncComponent(
  () => import('@/components/messenger/ModerationReportsDialog.vue')
)

/** Кого жалуем: пользователь и, если жалоба на сообщение, оно само. */
export interface ReportTarget {
  userId: number
  userName: string
  chatId?: number
  messageId?: number
  messagePreview?: string
}

defineProps<{
  /** Показывать ли служебный разбор жалоб (только администраторам). */
  isAdmin: boolean
}>()

const emit = defineEmits<{
  /** Жалоба отправлена. */
  sent: []
  /** Блокировка снята (список диалогов надо перечитать). */
  blockedChanged: []
}>()

const reportTarget = ref<ReportTarget | null>(null)
const showBlockedUsers = ref(false)
const showReports = ref(false)

/** Открыть жалобу (на собеседника или на конкретное сообщение). */
const openReport = (target: ReportTarget) => {
  reportTarget.value = target
}

/** Открыть список заблокированных. */
const openBlocked = () => {
  showBlockedUsers.value = true
}

/** Открыть разбор жалоб. */
const openReports = () => {
  showReports.value = true
}

defineExpose({ openReport, openBlocked, openReports })
</script>
