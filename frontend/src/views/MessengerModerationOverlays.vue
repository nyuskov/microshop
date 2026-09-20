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
  <!-- Разбор жалоб живёт разделом в настройках («Администрирование» → «Жалобы»):
       там есть кнопка «назад», а отдельное окно закрывало настройки и возвращало
       человека в чат. -->
  <BlockedUsersDialog
    v-if="showBlockedUsers"
    @close="showBlockedUsers = false"
    @unblocked="emit('blockedChanged')"
  />
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
import { useMobileLayer } from '@/composables/useMobileOverlay'

const ReportDialog = defineAsyncComponent(() => import('@/components/messenger/ReportDialog.vue'))
const BlockedUsersDialog = defineAsyncComponent(
  () => import('@/components/messenger/BlockedUsersDialog.vue')
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

/** Открыть жалобу (на собеседника или на конкретное сообщение). */
const openReport = (target: ReportTarget) => {
  reportTarget.value = target
}

/** Открыть список заблокированных. */
const openBlocked = () => {
  showBlockedUsers.value = true
}

defineExpose({ openReport, openBlocked })

// Диалоги модерации — слои общего стека: «назад» закрывает их по одному (иначе
// на телефоне он закрывал бы чат под открытой жалобой или выходил из приложения).
useMobileLayer(
  () => reportTarget.value !== null,
  () => {
    reportTarget.value = null
  }
)
useMobileLayer(
  () => showBlockedUsers.value,
  () => {
    showBlockedUsers.value = false
  }
)
</script>
