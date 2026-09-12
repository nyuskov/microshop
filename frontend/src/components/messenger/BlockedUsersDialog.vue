<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="mod-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="text-subtitle1 text-weight-medium">Заблокированные</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Закрыть" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="mod-body">
        <p class="mod-hint">
          Заблокированные не могут писать вам, а их диалоги скрыты из списка. Здесь блокировку можно
          снять.
        </p>

        <div v-if="loading" class="mod-empty">Загрузка…</div>
        <div v-else-if="users.length === 0" class="mod-empty">
          Заблокированных пользователей нет.
        </div>
        <ul v-else class="mod-list">
          <li v-for="user in users" :key="user.id" class="mod-row">
            <span class="mod-avatar" :style="avatarStyle(displayName(user))">
              <img v-if="avatarUrlOf(user)" :src="avatarUrlOf(user)" alt="" />
              <template v-else>{{ initials(displayName(user)) }}</template>
            </span>
            <span class="mod-name">
              <span class="mod-name-main">{{ displayName(user) }}</span>
              <span class="mod-name-sub">{{ user.phone_number || `@${user.username}` }}</span>
            </span>
            <q-btn
              flat
              no-caps
              dense
              color="primary"
              label="Разблокировать"
              :loading="busyId === user.id"
              @click="unblock(user.id)"
            />
          </li>
        </ul>

        <p v-if="error" class="mod-error" role="alert">{{ error }}</p>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { fetchBlockedUsers, unblockUser } from '@/services/moderation'
import type { SearchUserResult } from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'

const emit = defineEmits<{
  (e: 'close'): void
  /** Блокировка снята — родитель перечитывает список диалогов. */
  (e: 'unblocked'): void
}>()

const users = ref<SearchUserResult[]>([])
const loading = ref(true)
const busyId = ref<number | null>(null)
const error = ref('')

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    users.value = await fetchBlockedUsers()
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось загрузить список')
  } finally {
    loading.value = false
  }
}

const unblock = async (userId: number) => {
  if (busyId.value !== null) return
  busyId.value = userId
  error.value = ''
  try {
    await unblockUser(userId)
    users.value = users.value.filter((user) => user.id !== userId)
    emit('unblocked')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось снять блокировку')
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<style scoped>
.mod-card {
  width: min(480px, calc(100vw - 32px));
  border-radius: 18px;
}

.mod-body {
  max-height: 64vh;
  overflow: auto;
}

.mod-hint {
  margin: 0 0 12px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--ms-muted);
}

.mod-empty {
  padding: 18px 0;
  text-align: center;
  color: var(--ms-muted);
  font-size: 14px;
}

.mod-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mod-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.mod-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  color: var(--ms-on-accent);
  font-size: 15px;
  font-weight: 600;
}

.mod-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mod-name {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}

.mod-name-main {
  font-size: 14.5px;
}

.mod-name-sub {
  font-size: 12.5px;
  color: var(--ms-muted);
}

.mod-error {
  margin: 10px 0 0;
  color: var(--ms-danger);
  font-size: 13px;
}
</style>
