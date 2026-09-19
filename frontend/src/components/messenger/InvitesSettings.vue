<template>
  <div class="invites">
    <p class="invites-hint">
      Публичной регистрации нет: аккаунт создаётся только по личной ссылке. Ссылка одноразовая —
      после успешной регистрации гаснет, а передать её нужно лично приглашённому.
    </p>

    <!-- Создание -->
    <h3 class="invites-title">Новая ссылка</h3>
    <div class="invites-form">
      <label class="invites-label" for="invite-phone-new">Номер телефона (необязательно)</label>
      <PhoneInput
        id="invite-phone-new"
        v-model="phone"
        placeholder="+7 (900) 111-00-01"
        aria-label="Номер телефона для приглашения"
        :disable="busy"
      />

      <label class="invites-label gap" for="invite-note">Заметка для себя</label>
      <input
        id="invite-note"
        v-model="note"
        class="invites-field"
        type="text"
        maxlength="200"
        placeholder="Например: для Пети"
        :disabled="busy"
      />

      <span id="invite-days" class="invites-label gap">Срок действия</span>
      <div class="invites-chips" role="radiogroup" aria-labelledby="invite-days">
        <button
          v-for="option in EXPIRY_OPTIONS"
          :key="String(option.days)"
          type="button"
          class="invites-chip"
          :class="{ active: expiresDays === option.days }"
          role="radio"
          :aria-checked="expiresDays === option.days"
          :disabled="busy"
          @click="expiresDays = option.days"
        >
          {{ option.label }}
        </button>
      </div>

      <button class="invites-btn primary" type="button" :disabled="busy" @click="createInvite">
        <q-icon :name="icon('add')" size="17px" />
        <span>{{ busy ? 'Создаём…' : 'Создать ссылку' }}</span>
      </button>
    </div>

    <p v-if="notice" class="invites-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="invites-notice error" role="alert">{{ error }}</p>

    <!-- Только что созданная ссылка: её и нужно отдать человеку -->
    <div v-if="created" class="invites-created">
      <span class="invites-created-title">Ссылка готова</span>
      <input
        class="invites-link"
        type="text"
        readonly
        :value="linkOf(created)"
        @focus="selectAll"
      />
      <div class="invites-row">
        <button class="invites-btn" type="button" @click="copy(linkOf(created))">
          <q-icon :name="icon('content_copy')" size="16px" />
          <span>Скопировать</span>
        </button>
        <button v-if="canShare" class="invites-btn" type="button" @click="share(linkOf(created))">
          <q-icon :name="icon('share')" size="16px" />
          <span>Отправить</span>
        </button>
      </div>
      <!-- QR-код: приглашение можно показать рядом сидящему человеку с телефоном -->
      <div class="invites-qr">
        <QrCode :value="linkOf(created)" :size="168" label="QR-код ссылки-приглашения" />
      </div>
    </div>

    <!-- Список -->
    <h3 class="invites-title">
      Выданные ссылки
      <span v-if="activeCount > 0" class="invites-count"
        >{{ activeCount }} {{ pluralRu(activeCount, 'действует', 'действуют', 'действуют') }}</span
      >
    </h3>

    <p v-if="loading" class="invites-hint">Загружаем…</p>
    <p v-else-if="!invites.length" class="invites-hint">Ссылок пока нет.</p>

    <ul v-else class="invites-list">
      <li v-for="invite in invites" :key="invite.id" class="invites-item">
        <div class="invites-item-head">
          <span class="invites-status" :data-state="stateOf(invite)">{{ stateLabel(invite) }}</span>
          <span class="invites-item-title">{{ titleOf(invite) }}</span>
        </div>
        <p class="invites-item-meta">
          создано {{ dateOf(invite.created_at) }}
          <template v-if="invite.expires_at"> · до {{ dateOf(invite.expires_at) }}</template>
          <template v-if="invite.used_at"> · использовано {{ dateOf(invite.used_at) }}</template>
          <template v-if="invite.revoked_at"> · отозвано {{ dateOf(invite.revoked_at) }}</template>
        </p>
        <div class="invites-row">
          <button
            v-if="stateOf(invite) === 'active'"
            class="invites-btn"
            type="button"
            @click="copy(linkOf(invite))"
          >
            <q-icon :name="icon('content_copy')" size="16px" />
            <span>Скопировать</span>
          </button>
          <button
            v-if="stateOf(invite) === 'active'"
            class="invites-btn danger"
            type="button"
            :disabled="busyId === invite.id"
            @click="revoke(invite)"
          >
            <q-icon :name="icon('cancel')" size="16px" />
            <span>Отозвать</span>
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import PhoneInput from '@/components/common/PhoneInput.vue'
import QrCode from '@/components/common/QrCode.vue'
import { getErrorMessage } from '@/services/errors'
import {
  createRegistrationInvite,
  fetchRegistrationInvites,
  inviteLinkFor,
  inviteState,
  revokeRegistrationInvite,
  type InviteState,
  type RegistrationInvite
} from '@/services/invites'
import { icon } from '@/utils/icons'
import { parseServerTime, pluralRu } from '@/utils/format'
import { formatPhoneForBackend, formatPhoneInput, isValidPhoneNumber } from '@/utils/phone'

/**
 * Раздел настроек «Приглашения» (только для владельца сервиса).
 *
 * Раньше ссылки выдавал CLI-скрипт на сервере — теперь это можно сделать из
 * приложения, с телефона: создать, скопировать, отправить, отозвать. Пароль
 * приглашённый придумывает сам, владелец его не пересылает.
 */
const invites = ref<RegistrationInvite[]>([])
const activeCount = ref(0)
const loading = ref(true)
const busy = ref(false)
/** id приглашения, по которому сейчас идёт отзыв (кнопка показывает прогресс). */
const busyId = ref<number | null>(null)
const error = ref('')
const notice = ref('')
/** Только что созданная ссылка — держим её наверху, чтобы сразу скопировать. */
const created = ref<RegistrationInvite | null>(null)

const phone = ref('')
const note = ref('')
/**
 * Срок действия ссылки в днях (`null` — бессрочно).
 *
 * Выбирается чипами, а не родным списком браузера: его рисует сам браузер
 * (в WebView и при нестандартном масштабе — системным окошком далеко от поля,
 * на это и жаловался пользователь), а чипы всегда на месте, видны целиком и
 * выбираются одним касанием.
 */
const expiresDays = ref<number | null>(null)

/** Варианты срока действия ссылки: дни и подпись. */
const EXPIRY_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: 'Бессрочно' },
  { days: 1, label: '1 день' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' }
]

const canShare = computed(
  () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'
)

const linkOf = (invite: RegistrationInvite): string => inviteLinkFor(invite.token)
const stateOf = (invite: RegistrationInvite): InviteState => inviteState(invite)

const STATE_LABELS: Record<InviteState, string> = {
  active: 'действует',
  used: 'использована',
  revoked: 'отозвана',
  expired: 'истекла'
}
const stateLabel = (invite: RegistrationInvite): string => STATE_LABELS[stateOf(invite)]

const titleOf = (invite: RegistrationInvite): string =>
  invite.note || (invite.phone_number ? formatPhoneInput(invite.phone_number).value : 'Без заметки')

const dateOf = (iso: string | null): string => {
  if (!iso) return ''
  const date = parseServerTime(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU')
}

const selectAll = (event: Event) => {
  const target = event.target as HTMLInputElement
  target.select()
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchRegistrationInvites()
    invites.value = data.items
    activeCount.value = data.active
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось загрузить приглашения')
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function createInvite() {
  error.value = ''
  notice.value = ''
  const rawPhone = phone.value.trim()
  if (rawPhone) {
    const normalized = formatPhoneForBackend(rawPhone)
    if (!isValidPhoneNumber(normalized)) {
      error.value = 'Номер заполнен не полностью — либо очистите поле, либо введите его целиком.'
      return
    }
  }

  busy.value = true
  try {
    const invite = await createRegistrationInvite({
      phone_number: rawPhone ? formatPhoneForBackend(rawPhone) : null,
      note: note.value.trim() || null,
      expires_days: expiresDays.value
    })
    created.value = invite
    phone.value = ''
    note.value = ''
    notice.value = 'Ссылка создана — скопируйте и передайте её лично.'
    await load()
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось создать приглашение')
  } finally {
    busy.value = false
  }
}

async function revoke(invite: RegistrationInvite) {
  busyId.value = invite.id
  error.value = ''
  notice.value = ''
  try {
    await revokeRegistrationInvite(invite.id)
    if (created.value?.id === invite.id) created.value = null
    notice.value = 'Ссылка отозвана — по ней больше нельзя зарегистрироваться.'
    await load()
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось отозвать ссылку')
  } finally {
    busyId.value = null
  }
}

async function copy(link: string) {
  notice.value = ''
  error.value = ''
  try {
    await navigator.clipboard.writeText(link)
    notice.value = 'Ссылка скопирована'
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось скопировать ссылку')
  }
}

async function share(link: string) {
  error.value = ''
  try {
    await navigator.share({ url: link, title: 'Приглашение в Pismo' })
  } catch {
    /* Пользователь закрыл системное окно «Поделиться» — это не ошибка. */
  }
}
</script>

<style scoped>
.invites {
  padding: 4px 0 8px;
}

.invites-hint {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ms-muted);
}

.invites-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 18px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ms-muted-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.invites-count {
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: var(--ms-muted);
}

.invites-form {
  display: flex;
  flex-direction: column;
}

.invites-label {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--ms-muted);
}

.invites-label.gap {
  margin-top: 12px;
}

.invites-field {
  width: 100%;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  color: var(--ms-text);
  background: var(--ms-surface-2);
  border: 1px solid var(--ms-border);
  border-radius: 10px;
}

.invites-field:focus-visible {
  outline: 2px solid var(--ms-accent);
  outline-offset: 1px;
}

/* Срок действия — чипами (см. комментарий у EXPIRY_OPTIONS). */
.invites-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.invites-chip {
  padding: 8px 12px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--ms-muted);
  background: var(--ms-surface-2);
  border: 1px solid var(--ms-border);
  border-radius: 11px;
  cursor: pointer;
}

.invites-chip:hover {
  color: var(--ms-text);
  background: var(--ms-hover);
}

.invites-chip.active {
  background: var(--ms-accent-soft);
  border-color: var(--ms-accent-border);
  color: var(--ms-accent);
  font-weight: 600;
}

.invites-chip:disabled {
  opacity: 0.6;
  cursor: default;
}

.invites-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.invites-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  font-family: inherit;
  font-size: 13px;
  color: var(--ms-text);
  background: var(--ms-surface-2);
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  cursor: pointer;
}

.invites-btn:hover:not(:disabled) {
  background: var(--ms-hover);
}

.invites-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.invites-btn.primary {
  justify-content: center;
  margin-top: 14px;
  color: var(--ms-on-accent);
  background: var(--ms-accent);
  border-color: var(--ms-accent);
}

.invites-btn.danger {
  color: var(--ms-danger);
}

.invites-notice {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--ms-muted-2);
}

.invites-notice.error {
  color: var(--ms-danger);
}

.invites-created {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
  padding: 12px;
  background: var(--ms-ok-bg);
  border-radius: 12px;
}

/* QR-код приглашения: по центру, чтобы удобно было навести камеру */
.invites-qr {
  display: flex;
  justify-content: center;
  margin-top: var(--ms-space-2);
}

.invites-created-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ms-text);
}

.invites-link {
  width: 100%;
  padding: 8px 10px;
  font-family: var(--ms-font-mono);
  font-size: 12.5px;
  color: var(--ms-text);
  background: var(--ms-surface);
  border: 1px solid var(--ms-border);
  border-radius: 8px;
}

.invites-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.invites-item {
  padding: 12px;
  background: var(--ms-surface-2);
  border-radius: 12px;
}

.invites-item-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.invites-item-title {
  font-size: 14px;
  color: var(--ms-text);
}

.invites-item-meta {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--ms-muted);
}

/* Статус — текстовая плашка на подложке: цвет подложки несёт смысл,
   поэтому берём готовые токены состояний. */
.invites-status {
  padding: 2px 8px;
  font-size: var(--ms-fs-xs);
  border-radius: 999px;
  background: var(--ms-info-bg);
  color: var(--ms-info);
}

.invites-status[data-state='active'] {
  /* Пара «зелёная подложка + сильный акцент» — как у плашек успеха в остальном
     приложении (например, в профиле и на входе); отдельного --ms-ok нет. */
  background: var(--ms-ok-bg);
  color: var(--ms-accent-strong);
}

.invites-status[data-state='used'],
.invites-status[data-state='revoked'] {
  background: var(--ms-warn-bg);
  color: var(--ms-warn);
}

.invites-status[data-state='expired'] {
  background: var(--ms-hover);
  color: var(--ms-muted-2);
}
</style>
