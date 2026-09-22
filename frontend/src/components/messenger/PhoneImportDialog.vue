<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="phone-overlay ms-rows"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Добавить из контактов телефона')"
      @mousedown.self="emit('close')"
    >
      <div class="phone-card">
        <header class="phone-head">
          <div class="phone-title">
            <q-icon :name="icon('contacts')" size="18px" />
            <span>{{ t('Из контактов телефона') }}</span>
          </div>
          <button class="phone-xbtn" :title="t('Закрыть')" @click="emit('close')">
            <q-icon :name="icon('close')" size="20px" />
          </button>
        </header>

        <div class="phone-body">
          <button
            v-if="supported"
            class="phone-primary"
            :disabled="busy"
            @click="emit('pick-device')"
          >
            <q-icon :name="icon('phone_android')" size="20px" />
            <span>{{ busy ? 'Открываем…' : 'Выбрать из телефонной книги' }}</span>
          </button>
          <p v-else class="phone-hint">
            {{
              t('Браузер не открывает книгу напрямую — вставьте номера ниже (по одному в строке).')
            }}
          </p>

          <div class="phone-or">
            <span>{{ t('или') }}</span>
          </div>

          <label class="phone-label" for="phone-textarea">{{ t('Номера телефонов') }}</label>
          <textarea
            id="phone-textarea"
            :value="manualPhones"
            class="phone-textarea"
            rows="5"
            placeholder="+7 999 123-45-67&#10;+7 912 000-00-00"
            @input="emit('update:manualPhones', ($event.target as HTMLTextAreaElement).value)"
          ></textarea>

          <div class="phone-actions">
            <button class="phone-btn ghost" :disabled="busy" @click="emit('close')">
              {{ t('Отмена') }}
            </button>
            <button class="phone-btn primary" :disabled="busy" @click="emit('find')">
              {{ busy ? 'Поиск…' : 'Найти в мессенджере' }}
            </button>
          </div>

          <p v-if="error" class="phone-error">{{ error }}</p>

          <template v-if="matched !== null">
            <p class="phone-result-title">Найдено в мессенджере: {{ matched.length }}</p>
            <div v-if="!matched.length" class="phone-empty">
              {{ t('Никого из вашей книги нет в мессенджере') }}
            </div>
            <div v-else class="phone-results">
              <button
                v-for="user in matched"
                :key="user.id"
                class="phone-row"
                @click="emit('pick', user)"
              >
                <span class="avatar" :style="avatarStyle(displayName(user))">
                  <img
                    v-if="avatarUrlOf(user)"
                    :src="avatarUrlOf(user)"
                    class="avatar-img"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <template v-else>{{ initials(displayName(user)) }}</template>
                </span>
                <span class="phone-row-text">
                  <span class="phone-row-name">{{ displayName(user) }}</span>
                  <span class="phone-row-phone">@{{ user.username }}</span>
                </span>
                <q-icon :name="icon('chat_bubble')" class="phone-row-icon" size="18px" />
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Окно «Из контактов телефона»: выбор книги телефона или вставка номеров вручную,
 * поиск людей в мессенджере и переход в чат с найденным.
 *
 * Состояние живёт в `composables/usePhoneImport.ts` (его же использует список
 * контактов, чтобы показать найденных прямо там), а компонент только рисует окно
 * и сообщает о действиях — поэтому внутри ни одного своего ref.
 */
import { icon } from '@/utils/icons'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import type { SearchUserResult } from '@/services/chatService'
import { t } from '@/i18n'

defineProps<{
  /** Окно открыто. */
  open: boolean
  /** Идёт поиск или чтение книги — кнопки блокируем. */
  busy: boolean
  /** Текст ошибки поиска (пусто — ошибки нет). */
  error: string
  /** Вставленные вручную номера (v-model). */
  manualPhones: string
  /** Браузер умеет открывать книгу телефона (тогда кнопка вместо подсказки). */
  supported: boolean
  /** Кого нашли (null — поиск ещё не запускали). */
  matched: SearchUserResult[] | null
}>()

const emit = defineEmits<{
  (e: 'update:manualPhones', value: string): void
  (e: 'close'): void
  (e: 'pick-device'): void
  (e: 'find'): void
  (e: 'pick', user: SearchUserResult): void
}>()
</script>

<style scoped>
/* ---------- Импорт контактов телефона ---------- */
.phone-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: var(--ms-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-family: var(--ms-font);
}

.phone-card {
  width: min(440px, 100%);
  max-height: min(680px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #1c2733);
  border-radius: 18px;
  box-shadow: var(--ms-shadow-pop);
  overflow: hidden;
}

.phone-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 6px;
}

.phone-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ms-text-strong, #141d26);
}

.phone-title .q-icon {
  color: var(--ms-accent, #2ea25e);
}

.phone-xbtn {
  background: none;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-icon, #52626f);
  cursor: pointer;
}

.phone-xbtn:hover {
  background: var(--ms-hover, #f2f4f6);
  color: var(--ms-text-strong, #141d26);
}

.phone-body {
  padding: 8px 16px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.phone-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 12px;
  padding: 11px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: var(--ms-accent, #2ea25e);
  color: var(--ms-on-accent);
}

.phone-primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.phone-hint {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
}

.phone-or {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  color: var(--ms-muted, #93a0ab);
  font-size: 12px;
}

.phone-or::before,
.phone-or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--ms-border, #e2e6ea);
}

.phone-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
  margin-bottom: 5px;
}

.phone-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
  border-radius: 10px;
  padding: 9px 11px;
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
}

.phone-textarea:focus {
  border-color: var(--ms-accent, #2ea25e);
  background: var(--ms-surface, #ffffff);
}

.phone-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.phone-btn {
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.phone-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.phone-btn.ghost {
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
}

.phone-btn.primary {
  background: var(--ms-accent, #2ea25e);
  color: var(--ms-on-accent);
}

.phone-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--ms-danger, #d64545);
}

.phone-result-title {
  margin: 14px 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
}

.phone-empty {
  padding: 12px 4px;
  font-size: 13.5px;
  color: var(--ms-muted, #71808d);
}

.phone-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.phone-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 12px;
  padding: 8px 10px;
  cursor: pointer;
  color: inherit;
}

.phone-row:hover {
  background: var(--ms-hover, #f2f4f6);
}

.phone-row .avatar {
  width: 40px;
  height: 40px;
}

.phone-row-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.phone-row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text-strong, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.phone-row-phone {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.phone-row-icon {
  color: var(--ms-accent, #2ea25e);
  flex: none;
}

/* Встроенные результаты импорта из телефонной книги живут в ContactsPanel.vue:
   окно их больше не показывает (разметка .phone-inline — в сайдбаре). */
</style>
