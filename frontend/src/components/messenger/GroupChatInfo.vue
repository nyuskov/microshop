<template>
  <q-card class="grp-info-card">
    <q-card-section class="row no-wrap items-center grp-info-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">Информация о группе</div>
      <q-space />
      <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
    </q-card-section>
    <q-separator />
    <q-card-section class="grp-info-body">
      <div v-if="loading" class="grp-info-status">Загрузка…</div>
      <template v-else-if="detail">
        <!-- Шапка: аватар + название/описание (редактируемые) -->
        <div class="gi-hero">
          <div class="gi-avatar-row">
            <label class="gi-avatar" :style="avatarStyle(titleText)" title="Аватар группы">
              <img
                v-if="groupAvatar"
                :src="groupAvatar"
                class="gi-avatar-img"
                alt="Аватар группы"
              />
              <template v-else>{{ initials(titleText) }}</template>
              <input
                v-if="canManage"
                type="file"
                accept="image/*"
                class="gi-file-input"
                @change="onAvatarPick"
              />
              <span v-if="canManage" class="gi-avatar-hint">
                <q-icon name="photo_camera" size="18px" />
              </span>
            </label>
            <button
              v-if="canManage && groupAvatar"
              class="gi-icon-btn danger"
              title="Удалить аватар"
              aria-label="Удалить аватар"
              :disabled="busy"
              @click="onAvatarRemove"
            >
              <q-icon name="delete" size="18px" />
            </button>
          </div>

          <div v-if="canManage" class="gi-fields">
            <input
              v-model="nameInput"
              class="gi-input"
              type="text"
              maxlength="100"
              placeholder="Название группы"
              aria-label="Название группы"
            />
            <textarea
              v-model="descInput"
              class="gi-input gi-textarea"
              rows="2"
              maxlength="1024"
              placeholder="Описание группы"
              aria-label="Описание группы"
            ></textarea>
            <button class="gi-btn primary" :disabled="busy || !nameInput.trim()" @click="saveInfo">
              Сохранить
            </button>
          </div>
          <template v-else>
            <div class="gi-name">{{ detail.name }}</div>
            <div v-if="detail.description" class="gi-desc">{{ detail.description }}</div>
          </template>

          <div class="gi-meta">
            {{ memberCountText }}
            <template v-if="onlineCount > 0"> · {{ onlineCount }} в сети</template>
          </div>
        </div>

        <p v-if="error" class="gi-error">{{ error }}</p>

        <!-- Участники -->
        <div class="gi-section">
          <div class="gi-section-head">
            <h4 class="gi-title">Участники — {{ detail.members.length }}</h4>
            <button
              v-if="canManage"
              class="gi-add-btn"
              :disabled="busy"
              @click="addPanelOpen = !addPanelOpen"
            >
              <q-icon name="person_add" size="16px" />
              <span>Добавить</span>
            </button>
          </div>

          <!-- Выбор новых участников -->
          <div v-if="addPanelOpen" class="gi-add-panel">
            <input
              v-model="addQuery"
              class="gi-input"
              type="text"
              placeholder="Поиск по имени или логину"
              aria-label="Поиск участников"
            />
            <div class="gi-add-list">
              <button
                v-for="contact in addCandidates"
                :key="contact.id"
                type="button"
                class="gi-add-row"
                :class="{ on: addSelected.has(contact.id) }"
                @click="toggleAdd(contact.id)"
              >
                <span class="avatar" :style="avatarStyle(displayName(contact))">
                  <img
                    v-if="avatarUrlOf(contact)"
                    :src="avatarUrlOf(contact)"
                    class="avatar-img"
                    alt=""
                  />
                  <template v-else>{{ initials(displayName(contact)) }}</template>
                </span>
                <span class="gi-add-name">{{ displayName(contact) }}</span>
                <span class="gi-check" :class="{ on: addSelected.has(contact.id) }">
                  <q-icon v-if="addSelected.has(contact.id)" name="check" size="14px" />
                </span>
              </button>
              <div v-if="!addCandidates.length" class="gi-empty-line">
                Некого добавить — все ваши контакты уже в группе
              </div>
            </div>
            <div class="gi-add-actions">
              <button class="gi-btn ghost" @click="closeAddPanel">Отмена</button>
              <button
                class="gi-btn primary"
                :disabled="busy || addSelected.size === 0"
                @click="confirmAdd"
              >
                Добавить ({{ addSelected.size }})
              </button>
            </div>
          </div>

          <div class="gi-members">
            <div v-for="member in detail.members" :key="member.id" class="gi-member">
              <span class="avatar" :style="avatarStyle(displayName(member))">
                <img
                  v-if="avatarUrlOf(member)"
                  :src="avatarUrlOf(member)"
                  class="avatar-img"
                  alt=""
                />
                <template v-else>{{ initials(displayName(member)) }}</template>
              </span>
              <span class="gi-member-text">
                <span class="gi-member-name">
                  {{ displayName(member) }}
                  <span v-if="member.id === currentUserId">(вы)</span>
                </span>
                <span class="gi-member-sub">@{{ member.username }}</span>
              </span>
              <span class="gi-role" :class="'role-' + member.role">{{
                roleLabel(member.role)
              }}</span>
              <span v-if="memberActions(member).length" class="gi-member-actions">
                <button
                  v-for="action in memberActions(member)"
                  :key="action.key"
                  class="gi-mini-btn"
                  :class="{ danger: action.danger }"
                  :disabled="busy"
                  :title="action.title"
                  @click="runMemberAction(action, member)"
                >
                  <q-icon :name="action.icon" size="16px" />
                </button>
              </span>
            </div>
          </div>
        </div>

        <!-- Действия с группой -->
        <div class="gi-danger-zone">
          <button v-if="isCreator" class="gi-danger-btn" :disabled="busy" @click="deleteGroup">
            <q-icon name="delete_forever" size="18px" />
            <span>Удалить группу</span>
          </button>
          <button v-else class="gi-danger-btn" :disabled="busy" @click="leaveGroup">
            <q-icon name="logout" size="18px" />
            <span>Покинуть группу</span>
          </button>
        </div>
      </template>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { getErrorMessage } from '@/services/errors'
import {
  addGroupMembers,
  deleteChat,
  fetchChatDetail,
  removeGroupAvatar,
  removeGroupMember,
  setGroupMemberRole,
  updateGroupInfo,
  uploadGroupAvatar,
  type SearchUserResult
} from '@/services/chatService'
import type { Chat, ChatDetail, ChatMember } from '@/types'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { mediaUrl } from '@/config'

const props = defineProps<{
  chat: Chat
  currentUserId: number | null
  /** Контакты (для добавления новых участников). */
  contacts: SearchUserResult[]
  /** id пользователей, которые сейчас «в сети». */
  onlineUserIds?: number[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** Состав/название/аватар группы изменились — перечитать список чатов. */
  (e: 'updated'): void
  /** Пользователь покинул группу или удалил её — убрать чат локально. */
  (e: 'left'): void
}>()

const loading = ref(false)
const busy = ref(false)
const error = ref('')
const detail = ref<ChatDetail | null>(null)
const nameInput = ref('')
const descInput = ref('')

const addPanelOpen = ref(false)
const addQuery = ref('')
const addSelected = ref<Set<number>>(new Set())

const myRole = computed<string>(() => props.chat.my_role || detail.value?.my_role || 'member')
const isCreator = computed<boolean>(() => myRole.value === 'creator')
const canManage = computed<boolean>(() => myRole.value === 'creator' || myRole.value === 'admin')

const groupAvatar = computed<string | undefined>(() => {
  const url = detail.value?.avatar_url ?? props.chat.avatar_url
  return url ? mediaUrl(url) : undefined
})

const titleText = computed<string>(() => detail.value?.name || props.chat.name || 'Группа')

const memberCountText = computed<string>(() => {
  const n = detail.value?.members.length ?? props.chat.users.length ?? 0
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 14) return `${n} участников`
  if (last === 1) return `${n} участник`
  if (last >= 2 && last <= 4) return `${n} участника`
  return `${n} участников`
})

const onlineCount = computed<number>(() => {
  const online = props.onlineUserIds ?? []
  const ids = detail.value?.members.map((m) => m.id) ?? []
  return ids.filter((id) => online.includes(id)).length
})

const roleLabel = (role: string): string =>
  role === 'creator' ? 'Создатель' : role === 'admin' ? 'Админ' : ''

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    detail.value = await fetchChatDetail(props.chat.id)
    nameInput.value = detail.value.name
    descInput.value = detail.value.description || ''
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось загрузить информацию о группе')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.chat.id,
  () => {
    addPanelOpen.value = false
    void load()
  }
)

onMounted(() => {
  void load()
})

const saveInfo = async () => {
  if (!canManage.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const updated = await updateGroupInfo(props.chat.id, {
      name: nameInput.value.trim(),
      description: descInput.value.trim() || null
    })
    detail.value = { ...detail.value!, name: updated.name, description: updated.description }
    emit('updated')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось сохранить')
  } finally {
    busy.value = false
  }
}

const onAvatarPick = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !canManage.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const updated = await uploadGroupAvatar(props.chat.id, file)
    detail.value = { ...detail.value!, avatar_url: updated.avatar_url }
    emit('updated')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось загрузить аватар')
  } finally {
    busy.value = false
  }
}

const onAvatarRemove = async () => {
  if (!canManage.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const updated = await removeGroupAvatar(props.chat.id)
    detail.value = { ...detail.value!, avatar_url: updated.avatar_url }
    emit('updated')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось удалить аватар')
  } finally {
    busy.value = false
  }
}

// ---------- Добавление участников ----------
const memberIds = computed<Set<number>>(
  () => new Set((detail.value?.members ?? []).map((m) => m.id))
)

const addCandidates = computed<SearchUserResult[]>(() => {
  const ids = memberIds.value
  const q = addQuery.value.trim().toLowerCase()
  return props.contacts.filter((contact) => {
    if (ids.has(contact.id)) return false
    if (!q) return true
    return [contact.username, contact.first_name, contact.last_name, contact.phone_number]
      .filter(Boolean)
      .some((part) => (part as string).toLowerCase().includes(q))
  })
})

const toggleAdd = (userId: number) => {
  const next = new Set(addSelected.value)
  if (next.has(userId)) next.delete(userId)
  else next.add(userId)
  addSelected.value = next
}

const closeAddPanel = () => {
  addPanelOpen.value = false
  addQuery.value = ''
  addSelected.value = new Set()
}

const confirmAdd = async () => {
  if (busy.value || addSelected.value.size === 0) return
  busy.value = true
  error.value = ''
  try {
    await addGroupMembers(props.chat.id, Array.from(addSelected.value))
    closeAddPanel()
    await load()
    emit('updated')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось добавить участников')
  } finally {
    busy.value = false
  }
}

// ---------- Действия с участником ----------
interface MemberAction {
  key: string
  title: string
  icon: string
  danger?: boolean
}

const memberActions = (member: ChatMember): MemberAction[] => {
  if (!detail.value) return []
  const self = member.id === props.currentUserId
  const targetIsCreator = member.role === 'creator'
  const actions: MemberAction[] = []

  if (!self && isCreator.value && !targetIsCreator) {
    const isAdmin = member.role === 'admin'
    actions.push({
      key: isAdmin ? 'demote' : 'promote',
      title: isAdmin ? 'Снять с админов' : 'Сделать админом',
      icon: isAdmin ? 'shield_person' : 'admin_panel_settings'
    })
  }
  if (!self && !targetIsCreator && canManage.value) {
    if (isCreator.value || member.role === 'member') {
      actions.push({ key: 'kick', title: 'Исключить', icon: 'person_remove', danger: true })
    }
  }
  return actions
}

const runMemberAction = async (action: MemberAction, member: ChatMember) => {
  if (busy.value) return
  error.value = ''
  if (action.key === 'kick') {
    const name = displayName(member)
    if (!window.confirm(`Исключить ${name} из группы?`)) return
    busy.value = true
    try {
      await removeGroupMember(props.chat.id, member.id)
      await load()
      emit('updated')
    } catch (err) {
      error.value = getErrorMessage(err, 'Не удалось исключить участника')
    } finally {
      busy.value = false
    }
    return
  }
  if (action.key === 'promote' || action.key === 'demote') {
    busy.value = true
    try {
      await setGroupMemberRole(
        props.chat.id,
        member.id,
        action.key === 'promote' ? 'admin' : 'member'
      )
      await load()
      emit('updated')
    } catch (err) {
      error.value = getErrorMessage(err, 'Не удалось изменить роль')
    } finally {
      busy.value = false
    }
  }
}

// ---------- Выход / удаление группы ----------
const leaveGroup = async () => {
  if (!window.confirm('Покинуть группу? Вы перестанете получать её сообщения.')) return
  busy.value = true
  error.value = ''
  try {
    await deleteChat(props.chat.id, false)
    emit('left')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось покинуть группу')
  } finally {
    busy.value = false
  }
}

const deleteGroup = async () => {
  if (!window.confirm('Удалить группу для всех участников? Это действие нельзя отменить.')) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await deleteChat(props.chat.id, true)
    emit('left')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось удалить группу')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.grp-info-card {
  width: min(440px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  border-radius: var(--ms-radius-lg, 18px);
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #141d26);
}

.grp-info-head {
  padding: 8px 8px 8px 18px;
}

.grp-info-body {
  padding: 6px 18px 18px;
  max-height: 80vh;
  overflow-y: auto;
}

.grp-info-status {
  padding: 18px 0;
  text-align: center;
  color: var(--ms-muted, #71808d);
  font-size: 13.5px;
}

.gi-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 10px 0 6px;
}

.gi-avatar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.gi-avatar {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 2.1rem;
  overflow: hidden;
  cursor: default;
  position: relative;
}

.gi-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gi-file-input {
  display: none;
}

.gi-avatar-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.gi-avatar:hover .gi-avatar-hint {
  opacity: 1;
}

.gi-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ms-muted, #71808d);
  cursor: pointer;
}

.gi-icon-btn.danger:hover {
  color: #e0533d;
  background: rgba(224, 83, 61, 0.1);
}

.gi-name {
  margin-top: 10px;
  font-size: 17px;
  font-weight: 700;
  color: var(--ms-text, #141d26);
}

.gi-desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
  max-width: 360px;
}

.gi-meta {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--ms-accent, #2ea25e);
}

.gi-fields {
  margin-top: 12px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}

.gi-input {
  width: 100%;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 11px;
  background: var(--ms-surface-2, #ffffff);
  color: var(--ms-text, #1c2733);
  padding: 9px 11px;
  font-size: 14px;
  font-family: var(--ms-font), sans-serif;
}

.gi-input:focus {
  outline: none;
  border-color: var(--ms-accent, #2ea25e);
}

.gi-textarea {
  resize: none;
  line-height: 1.35;
}

.gi-section {
  margin-top: 14px;
}

.gi-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.gi-title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ms-muted, #71808d);
}

.gi-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: var(--ms-accent-soft, #e3f2e5);
  color: var(--ms-accent, #2ea25e);
  border-radius: 9px;
  padding: 5px 9px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: var(--ms-font), sans-serif;
  cursor: pointer;
}

.gi-add-btn:disabled {
  opacity: 0.5;
}

.gi-add-panel {
  margin-top: 8px;
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: 12px;
  padding: 10px;
  background: var(--ms-surface-2, #f6f8fa);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gi-add-list {
  max-height: 30vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gi-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 9px;
  padding: 5px 6px;
  cursor: pointer;
  text-align: left;
  font-family: var(--ms-font), sans-serif;
}

.gi-add-row:hover {
  background: var(--ms-hover, #eef1f4);
}

.gi-add-name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--ms-text, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gi-check {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--ms-border, #cfd6dd);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
}

.gi-check.on {
  background: var(--ms-accent, #2ea25e);
  border-color: var(--ms-accent, #2ea25e);
}

.gi-add-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.gi-empty-line {
  padding: 10px 4px;
  color: var(--ms-muted, #71808d);
  font-size: 12.5px;
}

.gi-btn {
  border: none;
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--ms-font), sans-serif;
  cursor: pointer;
}

.gi-btn.primary {
  background: var(--ms-accent, #2ea25e);
  color: #fff;
}

.gi-btn.ghost {
  background: transparent;
  color: var(--ms-muted, #71808d);
}

.gi-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.gi-members {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gi-member {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-radius: 10px;
}

.gi-member:hover {
  background: var(--ms-hover, #f2f4f6);
}

.gi-member-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.gi-member-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gi-member-sub {
  font-size: 12px;
  color: var(--ms-muted, #71808d);
}

.gi-role {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-radius: 8px;
  padding: 2px 7px;
  flex-shrink: 0;
}

.gi-role.role-creator {
  color: #e08e2e;
  background: rgba(224, 142, 46, 0.12);
}

.gi-role.role-admin {
  color: var(--ms-accent, #2ea25e);
  background: var(--ms-accent-soft, #e3f2e5);
}

.gi-role.role-member {
  display: none;
}

.gi-member-actions {
  display: inline-flex;
  gap: 2px;
  flex-shrink: 0;
}

.gi-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ms-muted-2, #5b6b79);
  cursor: pointer;
}

.gi-mini-btn:hover {
  background: var(--ms-hover, #e9edf1);
}

.gi-mini-btn.danger:hover {
  color: #e0533d;
  background: rgba(224, 83, 61, 0.12);
}

.gi-danger-zone {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--ms-border, #eef1f3);
}

.gi-danger-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  color: #e0533d;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 600;
  font-family: var(--ms-font), sans-serif;
  cursor: pointer;
  text-align: left;
}

.gi-danger-btn:hover {
  background: rgba(224, 83, 61, 0.08);
}

.gi-error {
  margin: 10px 0 0;
  color: #e0533d;
  font-size: 13px;
  text-align: center;
}

/* Общий аватар (как в списках чатов/контактов) */
.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9rem;
  flex-shrink: 0;
  overflow: hidden;
  user-select: none;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
