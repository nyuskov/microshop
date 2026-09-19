<template>
  <q-card class="grp-info-card" :class="{ 'is-panel': panel }">
    <q-card-section class="row no-wrap items-center grp-info-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">Информация о группе</div>
      <q-space />
      <!-- В панели (широкий экран) закрывать q-popup нечего — только событие. -->
      <q-btn
        v-if="panel"
        flat
        round
        dense
        icon="close"
        aria-label="Закрыть"
        @click="emit('close')"
      />
      <q-btn v-else flat round dense icon="close" v-close-popup aria-label="Закрыть" />
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
                decoding="async"
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
                <q-icon :name="icon('photo_camera')" size="18px" />
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
              <q-icon :name="icon('delete')" size="18px" />
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

        <!-- Тип группы: обычная / зашифрованная (E2EE) -->
        <div class="gi-section gi-e2ee">
          <div class="gi-e2ee-row">
            <div class="gi-e2ee-info">
              <div class="gi-e2ee-title">Сквозное шифрование</div>
              <div class="gi-e2ee-desc">
                Обычная группа — текст и файлы читает сервер (видны в превью и уведомлениях).
                Зашифрованная — переписку читают только участники; ключ группы хранится на
                устройствах и меняется, когда состав группы меняется.
              </div>
            </div>
            <q-toggle
              :model-value="!!e2eeEnabled"
              color="primary"
              keep-color
              :disable="e2eeBusy || busy || !canManage"
              aria-label="Сквозное шифрование группы"
              @update:model-value="onToggleE2ee"
            />
          </div>
          <p v-if="!canManage" class="gi-e2ee-hint">
            Включить или выключить шифрование может создатель группы или админ.
          </p>
        </div>

        <!-- Ссылка-приглашение: создатель или админ зовёт по ссылке -->
        <div v-if="canManage" class="gi-section">
          <div class="gi-section-head">
            <h4 class="gi-title">Пригласить по ссылке</h4>
            <button
              class="gi-add-btn"
              :disabled="inviteBusy || !!activeInvite"
              @click="createInviteLink"
            >
              <q-icon :name="icon('share')" size="16px" />
              <span>{{ activeInvite ? 'Ссылка готова' : 'Создать' }}</span>
            </button>
          </div>
          <p class="gi-invite-hint">
            Ссылку можно отправить любому человеку: он увидит карточку группы и вступит сам.
            <template v-if="!e2eeEnabled">Срок действия — пока не отзовёте.</template>
            <template v-else>
              В зашифрованной группе вход по ссылке закрыт: ключ выдаёт участник группы, поэтому
              добавляйте людей вручную.
            </template>
          </p>

          <div v-if="activeInvite" class="gi-invite-active">
            <input
              class="gi-input gi-invite-url"
              type="text"
              readonly
              aria-label="Ссылка-приглашение"
              :value="inviteLinkOf(activeInvite)"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <div class="gi-invite-actions">
              <button class="gi-btn" :disabled="inviteBusy" @click="copyInviteLink">
                {{ inviteCopied ? 'Скопировано' : 'Копировать' }}
              </button>
              <button
                v-if="canShareInvite"
                class="gi-btn"
                :disabled="inviteBusy"
                @click="shareInviteLink"
              >
                Поделиться
              </button>
              <button class="gi-btn danger" :disabled="inviteBusy" @click="revokeInviteLink">
                Отозвать
              </button>
            </div>
            <div v-if="inviteError" class="gi-error">{{ inviteError }}</div>
          </div>
          <div v-else-if="inviteError" class="gi-error">{{ inviteError }}</div>
        </div>

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
              <q-icon :name="icon('person_add')" size="16px" />
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
                    loading="lazy"
                    decoding="async"
                  />
                  <template v-else>{{ initials(displayName(contact)) }}</template>
                </span>
                <span class="gi-add-name">{{ displayName(contact) }}</span>
                <span class="gi-check" :class="{ on: addSelected.has(contact.id) }">
                  <q-icon v-if="addSelected.has(contact.id)" :name="icon('check')" size="14px" />
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

          <!-- Мут: длительность выбирается пресетами (как в Telegram) -->
          <div v-if="muteTarget" class="gi-add-panel">
            <div class="gi-panel-title">Замутить {{ displayName(muteTarget) }}</div>
            <div class="gi-presets">
              <button
                v-for="option in MUTE_OPTIONS"
                :key="option.minutes"
                type="button"
                class="gi-preset"
                :disabled="busy"
                @click="applyMute(option.minutes)"
              >
                {{ option.label }}
              </button>
            </div>
            <div class="gi-add-actions">
              <button class="gi-btn ghost" @click="muteTarget = null">Отмена</button>
              <button
                v-if="isMuted(muteTarget)"
                class="gi-btn danger"
                :disabled="busy"
                @click="applyMute(null)"
              >
                Снять мут
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
                  loading="lazy"
                  decoding="async"
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
              <span v-if="isMuted(member)" class="gi-muted">в муте</span>
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
                  <q-icon :name="icon(action.icon)" size="16px" />
                </button>
              </span>
            </div>
          </div>
        </div>

        <!-- Анти-флуд: медленный режим и бан-лист (видят создатель и админы) -->
        <div v-if="canManage" class="gi-section">
          <h4 class="gi-title">Анти-флуд</h4>
          <div class="gi-row">
            <span class="gi-row-label">Медленный режим</span>
            <span class="gi-row-value">{{ slowModeLabel }}</span>
            <button class="gi-btn ghost" :disabled="busy" @click="slowPanelOpen = !slowPanelOpen">
              Изменить
            </button>
          </div>
          <p class="gi-hint">
            Участники ждут паузу между сообщениями; админов режим не ограничивает.
          </p>
          <div v-if="slowPanelOpen" class="gi-presets">
            <button
              v-for="option in SLOW_MODE_OPTIONS"
              :key="option.seconds"
              type="button"
              class="gi-preset"
              :class="{ on: slowMode === option.seconds }"
              :disabled="busy"
              @click="applySlowMode(option.seconds)"
            >
              {{ option.label }}
            </button>
          </div>

          <div v-if="bans.length" class="gi-bans">
            <div class="gi-bans-title">Забаненные — {{ bans.length }}</div>
            <div v-for="ban in bans" :key="ban.id" class="gi-ban-row">
              <span class="gi-ban-name">{{ banName(ban) }}</span>
              <span v-if="ban.reason" class="gi-ban-reason">{{ ban.reason }}</span>
              <button class="gi-btn ghost" :disabled="busy" @click="unban(ban)">Разбанить</button>
            </div>
            <p class="gi-hint">Забаненный не вернётся по ссылке, пока вы не снёте бан.</p>
          </div>

          <div v-if="error" class="gi-error">{{ error }}</div>
        </div>

        <!-- Действия с группой -->
        <div class="gi-danger-zone">
          <button v-if="isCreator" class="gi-danger-btn" :disabled="busy" @click="deleteGroup">
            <q-icon :name="icon('delete_forever')" size="18px" />
            <span>Удалить группу</span>
          </button>
          <button v-else class="gi-danger-btn" :disabled="busy" @click="leaveGroup">
            <q-icon :name="icon('logout')" size="18px" />
            <span>Покинуть группу</span>
          </button>
        </div>
      </template>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getErrorMessage } from '@/services/errors'
import {
  addGroupMembers,
  banGroupMember,
  createGroupInvite,
  deleteChat,
  fetchChatDetail,
  fetchGroupBans,
  fetchGroupInvites,
  muteGroupMember,
  removeGroupAvatar,
  removeGroupMember,
  revokeGroupInvite,
  setGroupMemberRole,
  setGroupSlowMode,
  unbanGroupMember,
  updateGroupInfo,
  uploadGroupAvatar,
  type SearchUserResult
} from '@/services/chatService'
import type { Chat, ChatBanEntry, ChatDetail, ChatMember, GroupInvite } from '@/types'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { optimizeAvatarFile } from '@/utils/media'
import { inviteLinkFor } from '@/utils/groupInvite'
import { confirmDialog } from '@/utils/appDialogs'
import { mediaUrl } from '@/config'

const props = defineProps<{
  chat: Chat
  currentUserId: number | null
  /** Контакты (для добавления новых участников). */
  contacts: SearchUserResult[]
  /** id пользователей, которые сейчас «в сети». */
  onlineUserIds?: number[]
  /** Включено ли сквозное шифрование в группе. */
  e2eeEnabled?: boolean
  /** Идёт переключение шифрования (блокирует тумблер). */
  e2eeBusy?: boolean
  /**
   * Режим правой панели (широкий экран): та же карточка, но без рамки, на всю
   * высоту колонки и с прокруткой внутри (см. ChatInfo.vue — там то же самое).
   */
  panel?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** Состав/название/аватар группы изменились — перечитать список чатов. */
  (e: 'updated'): void
  /** Пользователь покинул группу или удалил её — убрать чат локально. */
  (e: 'left'): void
  /** Переключатель «Сквозное шифрование». */
  (e: 'toggle-e2ee', enabled: boolean): void
  /**
   * Состав группы изменился. `rotate=true` — участника исключили: ключ группы
   * нужно выпустить заново, иначе исключённый читал бы новые сообщения.
   */
  (e: 'members-changed', rotate: boolean): void
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

// ---------- Анти-флуд: мут, бан и медленный режим ----------
// Пресеты как в Telegram: у мута — длительность, у режима — пауза. Свободный
// ввод минут здесь только мешал бы: выбирают быстро и с телефона.
const MUTE_OPTIONS = [
  { minutes: 5, label: '5 минут' },
  { minutes: 60, label: '1 час' },
  { minutes: 8 * 60, label: '8 часов' },
  { minutes: 24 * 60, label: '24 часа' },
  { minutes: 7 * 24 * 60, label: '7 дней' }
]

const SLOW_MODE_OPTIONS = [
  { seconds: 0, label: 'Выкл' },
  { seconds: 10, label: '10 сек' },
  { seconds: 30, label: '30 сек' },
  { seconds: 60, label: '1 мин' },
  { seconds: 5 * 60, label: '5 мин' },
  { seconds: 15 * 60, label: '15 мин' },
  { seconds: 60 * 60, label: '1 час' }
]

/** Участник, которому выбираем мут (null — панель закрыта). */
const muteTarget = ref<ChatMember | null>(null)
const slowPanelOpen = ref(false)
const bans = ref<ChatBanEntry[]>([])

/** Мут действует, пока не истёк срок: истёкший не показываем как «в муте». */
const isMuted = (member: ChatMember): boolean => {
  if (!member.muted_until) return false
  return new Date(member.muted_until).getTime() > Date.now()
}

const slowMode = computed<number>(() => props.chat.slow_mode_seconds ?? 0)
const slowModeLabel = computed<string>(
  () =>
    SLOW_MODE_OPTIONS.find((option) => option.seconds === slowMode.value)?.label ??
    `${slowMode.value} сек`
)

/** Имя забаненного: сервер может не отдать данные удалённого аккаунта. */
const banName = (ban: ChatBanEntry): string =>
  ban.user ? displayName(ban.user) : `Пользователь #${ban.user_id}`

const loadBans = async () => {
  try {
    bans.value = await fetchGroupBans(props.chat.id)
  } catch {
    // Бан-лист — дополнительная информация: без него карточка остаётся рабочей.
    bans.value = []
  }
}

const applyMute = async (minutes: number | null) => {
  const member = muteTarget.value
  if (!member || busy.value) return
  busy.value = true
  error.value = ''
  try {
    // Ответ — вся карточка группы: список участников и метки «в муте» свежие.
    detail.value = await muteGroupMember(props.chat.id, member.id, minutes)
    muteTarget.value = null
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось изменить мут')
  } finally {
    busy.value = false
  }
}

const applyBan = async (member: ChatMember) => {
  const name = displayName(member)
  const agreed = await confirmDialog({
    title: `Забанить ${name}?`,
    message:
      'Человек будет исключён и не сможет вернуться по ссылке-приглашению, пока бан не снимут.',
    okLabel: 'Забанить',
    danger: true
  })
  if (!agreed || busy.value) return
  busy.value = true
  error.value = ''
  try {
    detail.value = await banGroupMember(props.chat.id, member.id)
    await loadBans()
    emit('updated')
    // Забаненный не должен читать новые сообщения — ключ группы выпускаем заново.
    emit('members-changed', true)
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось забанить участника')
  } finally {
    busy.value = false
  }
}

const unban = async (ban: ChatBanEntry) => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await unbanGroupMember(props.chat.id, ban.user_id)
    await loadBans()
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось снять бан')
  } finally {
    busy.value = false
  }
}

const applySlowMode = async (seconds: number) => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await setGroupSlowMode(props.chat.id, seconds)
    slowPanelOpen.value = false
    // Родитель перечитает чаты: у чата появится новый `slow_mode_seconds`.
    emit('updated')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось изменить медленный режим')
  } finally {
    busy.value = false
  }
}

// ---------- Ссылка-приглашение ----------
// Создатель или админ делает ссылку и отправляет её другу; тот открывает
// карточку группы и вступает сам (см. `resolveInviteLink` в Messenger.vue).
const invites = ref<GroupInvite[]>([])
const inviteBusy = ref(false)
const inviteError = ref('')
const inviteCopied = ref(false)
let inviteCopiedTimer: ReturnType<typeof setTimeout> | undefined

/** Действующая ссылка: в карточке достаточно одной, лишние создаются вручную. */
const activeInvite = computed<GroupInvite | null>(
  () => invites.value.find((invite) => invite.active) ?? null
)

/** Полная ссылка со СВОИМ origin: в разработке это localhost, в проде — домен. */
const inviteLinkOf = (invite: GroupInvite): string =>
  inviteLinkFor(invite.token, typeof window === 'undefined' ? '' : window.location.origin) ?? ''

const canShareInvite = computed<boolean>(
  () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'
)

const loadInvites = async () => {
  try {
    invites.value = await fetchGroupInvites(props.chat.id)
    inviteError.value = ''
  } catch (err) {
    inviteError.value = getErrorMessage(err, 'Не удалось загрузить ссылки')
  }
}

const createInviteLink = async () => {
  if (inviteBusy.value || activeInvite.value) return
  inviteBusy.value = true
  inviteError.value = ''
  try {
    const invite = await createGroupInvite(props.chat.id)
    invites.value = [invite, ...invites.value]
  } catch (err) {
    inviteError.value = getErrorMessage(err, 'Не удалось создать ссылку')
  } finally {
    inviteBusy.value = false
  }
}

const copyInviteLink = async () => {
  const invite = activeInvite.value
  if (!invite) return
  inviteError.value = ''
  try {
    await navigator.clipboard.writeText(inviteLinkOf(invite))
    inviteCopied.value = true
    if (inviteCopiedTimer !== undefined) window.clearTimeout(inviteCopiedTimer)
    inviteCopiedTimer = window.setTimeout(() => {
      inviteCopied.value = false
    }, 2500)
  } catch (err) {
    inviteError.value = getErrorMessage(err, 'Не удалось скопировать ссылку')
  }
}

/** Системное «Поделиться» (Android/десктоп) — там, где оно есть. */
const shareInviteLink = async () => {
  const invite = activeInvite.value
  if (!invite || !canShareInvite.value) return
  inviteError.value = ''
  try {
    await navigator.share({ text: inviteLinkOf(invite) })
  } catch {
    /* человек закрыл окно «Поделиться» — это не ошибка */
  }
}

const revokeInviteLink = async () => {
  const invite = activeInvite.value
  if (!invite || inviteBusy.value) return
  inviteBusy.value = true
  inviteError.value = ''
  try {
    await revokeGroupInvite(props.chat.id, invite.id)
    invites.value = invites.value.filter((item) => item.id !== invite.id)
    inviteCopied.value = false
  } catch (err) {
    inviteError.value = getErrorMessage(err, 'Не удалось отозвать ссылку')
  } finally {
    inviteBusy.value = false
  }
}

const myRole = computed<string>(() => props.chat.my_role || detail.value?.my_role || 'member')
const isCreator = computed<boolean>(() => myRole.value === 'creator')
const canManage = computed<boolean>(() => myRole.value === 'creator' || myRole.value === 'admin')

/** Тумблер «Сквозное шифрование» — решение принимает родитель (Messenger). */
const onToggleE2ee = (value: boolean | string | null) => {
  emit('toggle-e2ee', value === true || value === 'true')
}

const groupAvatar = computed<string | undefined>(() => {
  // Аватар группы в шапке — кружок 56px: миниатюры хватает с запасом.
  const url =
    detail.value?.avatar_thumb_url ??
    detail.value?.avatar_url ??
    props.chat.avatar_thumb_url ??
    props.chat.avatar_url
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
    if (canManage.value) {
      void loadInvites()
      void loadBans()
    }
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
    // Панели анти-флуда тоже закрываем: они про прошлый чат.
    muteTarget.value = null
    slowPanelOpen.value = false
    void load()
  }
)

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  if (inviteCopiedTimer !== undefined) window.clearTimeout(inviteCopiedTimer)
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
    // Сжимаем перед отправкой: с телефона фото может быть в мегабайты.
    const updated = await uploadGroupAvatar(props.chat.id, await optimizeAvatarFile(file))
    detail.value = {
      ...detail.value!,
      avatar_url: updated.avatar_url,
      avatar_thumb_url: updated.avatar_thumb_url
    }
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
    detail.value = {
      ...detail.value!,
      avatar_url: updated.avatar_url,
      avatar_thumb_url: updated.avatar_thumb_url
    }
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
    // Новому участнику нужна своя обёртка ключа группы (ротация не нужна).
    emit('members-changed', false)
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
      // Анти-флуд доступен там же, где исключение: обычно это одно решение.
      actions.push(
        isMuted(member)
          ? { key: 'unmute', title: 'Снять мут', icon: 'notifications' }
          : { key: 'mute', title: 'Замутить', icon: 'notifications_off' }
      )
      actions.push({ key: 'ban', title: 'Забанить', icon: 'block', danger: true })
    }
  }
  return actions
}

const runMemberAction = async (action: MemberAction, member: ChatMember) => {
  if (busy.value) return
  error.value = ''
  if (action.key === 'mute') {
    // Длительность выбирается отдельной панелью: сразу мутить на 24 часа —
    // частый промах, а «на 5 минут» — типичный случай.
    muteTarget.value = member
    return
  }
  if (action.key === 'unmute') {
    muteTarget.value = member
    await applyMute(null)
    return
  }
  if (action.key === 'ban') {
    await applyBan(member)
    return
  }
  if (action.key === 'kick') {
    const name = displayName(member)
    const agreed = await confirmDialog({
      title: `Исключить ${name} из группы?`,
      message:
        'Человек перестанет получать сообщения группы. Вернуть его можно повторным приглашением.',
      okLabel: 'Исключить',
      danger: true
    })
    if (!agreed) return
    busy.value = true
    try {
      await removeGroupMember(props.chat.id, member.id)
      await load()
      emit('updated')
      // Исключённый не должен читать новые сообщения — ключ выпускаем заново.
      emit('members-changed', true)
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
  const agreed = await confirmDialog({
    title: 'Покинуть группу?',
    message: 'Вы перестанете получать её сообщения.',
    okLabel: 'Покинуть',
    danger: true
  })
  if (!agreed) return
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
  const agreed = await confirmDialog({
    title: 'Удалить группу для всех участников?',
    message: 'Это действие нельзя отменить: история и участники удалятся у всех.',
    okLabel: 'Удалить',
    danger: true
  })
  if (!agreed) return
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

/* Режим правой панели (≥1280px): карточка занимает колонку целиком, прокрутка
   внутри тела (см. также ChatInfo.vue — там то же самое). */
.grp-info-card.is-panel {
  width: 100%;
  height: 100%;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.grp-info-card.is-panel .grp-info-body {
  flex: 1;
  min-height: 0;
  max-height: none;
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
  color: var(--ms-on-accent);
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
  background: var(--ms-backdrop);
  color: var(--ms-on-accent);
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
  color: var(--ms-danger);
  background: var(--ms-danger-bg);
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

/* Тип группы: обычная / зашифрованная (E2EE) */
.gi-e2ee-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--ms-border, #e3e8ee);
  border-radius: var(--ms-radius, 12px);
  background: var(--ms-surface-2, #f5f7fa);
}

.gi-e2ee-info {
  flex: 1;
  min-width: 0;
}

.gi-e2ee-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ms-text, #1c2733);
}

.gi-e2ee-desc {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--ms-muted, #71808d);
}

.gi-e2ee-hint {
  margin: 6px 2px 0;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted, #71808d);
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

/* Ссылка-приглашение в группу */
.gi-invite-hint {
  margin: 6px 0 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ms-muted, #71808d);
}

.gi-invite-active {
  margin-top: 8px;
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: 12px;
  padding: 10px;
  background: var(--ms-surface-2, #f6f8fa);
}

.gi-invite-url {
  font-size: 12.5px;
  color: var(--ms-muted, #5c6a75);
  text-overflow: ellipsis;
}

.gi-invite-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.gi-invite-actions .gi-btn {
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #1c2733);
  border: 1px solid var(--ms-border, #dfe5ea);
}

.gi-invite-actions .gi-btn.danger {
  color: var(--ms-danger, #d64545);
}

.gi-invite-actions .gi-btn:disabled {
  opacity: 0.55;
  cursor: default;
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
  color: var(--ms-on-accent);
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
  color: var(--ms-on-accent);
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
  font-size: var(--ms-fs-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-radius: 8px;
  padding: 2px 7px;
  flex-shrink: 0;
}

/* Метка «в муте»: видно, почему человек не пишет (снимается сама по времени). */
.gi-muted {
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  color: var(--ms-warn);
  background: var(--ms-warn-bg);
  border-radius: 8px;
  padding: 2px 7px;
  flex-shrink: 0;
}

/* Заголовок панели анти-флуда (выбор длительности мута). */
.gi-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ms-text, #141d26);
}

/* Пресеты (длительность мута, пауза медленного режима) — кнопки-таблетки. */
.gi-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.gi-preset {
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #fff);
  color: var(--ms-text, #141d26);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: var(--ms-fs-sm);
  font-family: var(--ms-font), sans-serif;
  cursor: pointer;
}

.gi-preset.on {
  background: var(--ms-accent-soft, #e3f2e5);
  color: var(--ms-accent, #2ea25e);
  font-weight: 600;
}

.gi-preset:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Строка настройки: подпись слева, значение и кнопка справа. */
.gi-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.gi-row-label {
  font-size: 13px;
  color: var(--ms-text, #141d26);
}

.gi-row-value {
  margin-left: auto;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  color: var(--ms-accent, #2ea25e);
}

.gi-hint {
  margin: 6px 0 0;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted, #71808d);
}

.gi-bans {
  margin-top: 12px;
}

.gi-bans-title {
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  color: var(--ms-text, #141d26);
}

.gi-ban-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.gi-ban-name {
  font-size: 13px;
  color: var(--ms-text, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gi-ban-reason {
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted, #71808d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gi-ban-row .gi-btn {
  margin-left: auto;
  flex-shrink: 0;
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
  color: var(--ms-danger);
  background: var(--ms-danger-bg);
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
  color: var(--ms-danger);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 600;
  font-family: var(--ms-font), sans-serif;
  cursor: pointer;
  text-align: left;
}

.gi-danger-btn:hover {
  background: var(--ms-danger-bg);
}

.gi-error {
  margin: 10px 0 0;
  color: var(--ms-danger);
  font-size: 13px;
  text-align: center;
}

/* Общий аватар (как в списках чатов/контактов) */
.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: var(--ms-on-accent);
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
