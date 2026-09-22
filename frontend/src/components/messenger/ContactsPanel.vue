<template>
  <div class="contacts-panel">
    <div class="panel-search">
      <q-icon :name="icon('search')" class="search-icon" size="17px" />
      <input
        v-model="query"
        class="panel-search-input"
        type="text"
        :placeholder="t('Поиск по логину или телефону')"
        :aria-label="t('Поиск контактов')"
      />
    </div>

    <!-- Результаты импорта из телефонной книги (показываются прямо в списке) -->
    <div v-if="props.phoneMatched !== null && !props.phoneImportOpen" class="phone-inline">
      <div class="phone-inline-head">
        <span class="phone-result-title">Из телефонной книги: {{ props.phoneMatched.length }}</span>
        <button
          class="phone-inline-clear"
          :title="t('Закрыть результаты')"
          :aria-label="t('Закрыть результаты')"
          @click="emit('clear-phone')"
        >
          <q-icon :name="icon('close')" size="18px" />
        </button>
      </div>
      <p v-if="props.phoneError" class="phone-error">{{ props.phoneError }}</p>
      <div v-if="!props.phoneBusy && !props.phoneMatched.length" class="empty-hint">
        Никого из вашей книги нет в мессенджере
      </div>
      <div v-else class="phone-inline-list">
        <button
          v-for="user in props.phoneMatched"
          :key="user.id"
          class="row-item"
          @click="emit('pick-phone', user)"
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
          <span class="row-text">
            <span class="row-title">{{ displayName(user) }}</span>
            <span class="row-sub"
              >@{{ user.username
              }}<template v-if="user.phone_number"> · {{ user.phone_number }}</template></span
            >
          </span>
          <q-icon :name="icon('chat_bubble')" class="row-arrow" size="18px" />
        </button>
      </div>
    </div>

    <!-- Список контактов: моя записная книжка (кого я добавил) -->
    <template v-if="props.phoneMatched === null || props.phoneImportOpen">
      <div v-if="props.loading" class="sk-list" aria-busy="true">
        <span class="sr-only">{{ t('Загрузка контактов…') }}</span>
        <div v-for="n in 6" :key="n" class="sk-row">
          <span class="sk-avatar"></span>
          <span class="sk-lines">
            <span class="sk-line" :style="{ width: 35 + ((n * 17) % 40) + '%' }"></span>
            <span class="sk-line short"></span>
          </span>
        </div>
      </div>

      <template v-else>
        <!-- Найденные в мессенджере (по поиску) — кого можно добавить -->
        <div v-if="busy" class="search-status" aria-busy="true">{{ t('Ищем людей…') }}</div>
        <template v-else-if="found.length">
          <div class="section-label">{{ t('Найдены в мессенджере') }}</div>
          <div class="people-results">
            <div v-for="user in found" :key="user.id" class="contact-row">
              <button class="row-item" @click="emit('pick', user)">
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
                <span class="row-text">
                  <span class="row-title">{{ displayName(user) }}</span>
                  <span class="row-sub">@{{ user.username }}</span>
                </span>
              </button>
              <button
                class="contact-action"
                :title="t('Добавить в контакты')"
                :aria-label="t('Добавить в контакты')"
                @click="emit('rename', user)"
              >
                <q-icon :name="icon('person_add')" size="18px" />
              </button>
            </div>
          </div>
        </template>

        <p v-if="error" class="cn-side-error">{{ error }}</p>

        <div v-if="!filtered.length && !found.length" class="empty-hint">
          {{
            query.trim()
              ? 'Никого не нашли — проверьте логин или телефон'
              : 'Контактов пока нет. Найдите человека по логину или телефону и добавьте его.'
          }}
        </div>

        <div v-else-if="filtered.length" class="chat-scroll">
          <div v-for="contact in filtered" :key="contact.id" class="contact-row">
            <button class="row-item" @click="emit('pick', contact)">
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
              <span class="row-text">
                <span class="row-title">{{ displayName(contact) }}</span>
                <span class="row-sub"
                  >@{{ contact.username
                  }}<template v-if="contact.phone_number">
                    · {{ contact.phone_number }}</template
                  ></span
                >
              </span>
            </button>
            <button
              class="contact-action"
              :title="t('Имя контакта')"
              :aria-label="t('Имя контакта')"
              @click="emit('rename', contact)"
            >
              <q-icon :name="icon('edit')" size="17px" />
            </button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Раздел «Контакты»: поиск (моя записная книжка + найденные в мессенджере) и
 * результаты импорта из телефонной книги.
 *
 * Вынесено из `ChatSidebar.vue`. Здесь только разметка и состояние поиска
 * (`composables/useContactSearch.ts`); открытие чата, диалог имени контакта и
 * сам импорт остаются у сайдбара и приходят событиями.
 */
import { icon } from '@/utils/icons'
import type { ChatUser } from '@/types'
import type { SearchUserResult } from '@/services/chatService'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { useContactSearch } from '@/composables/useContactSearch'
import { t } from '@/i18n'

const props = defineProps<{
  contacts: ChatUser[]
  currentUserId: number | null
  /** Контакты ещё грузятся с сервера. */
  loading: boolean
  /** Найденные по телефонной книге (`null` — импорт не запускали). */
  phoneMatched: SearchUserResult[] | null
  phoneBusy: boolean
  phoneError: string
  /** Окно импорта открыто — инлайн-результаты прячем. */
  phoneImportOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'pick', user: ChatUser | SearchUserResult): void
  (e: 'rename', user: ChatUser | SearchUserResult): void
  (e: 'clear-phone'): void
  (e: 'pick-phone', user: SearchUserResult): void
}>()

const { query, found, filtered, busy, error } = useContactSearch({
  contacts: () => props.contacts,
  currentUserId: () => props.currentUserId
})
</script>

<style scoped>
/* Панель занимает место раздела в сайдбаре: поле сверху, список — остаток. */
.contacts-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.contacts-panel .panel-search {
  flex-shrink: 0;
}

.cn-side-error {
  margin: 0;
  padding: 10px 14px;
  color: var(--ms-danger);
  font-size: 12.5px;
}

/* ---------- Результаты импорта из телефонной книги (прямо в списке) ---------- */
.phone-inline {
  padding: 4px 12px 6px;
  border-top: 1px solid var(--ms-border, #eef1f3);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.phone-inline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 2px 2px;
}

.phone-inline-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 50%;
  color: var(--ms-muted, #71808d);
  cursor: pointer;
}

.phone-inline-clear:hover {
  background: var(--ms-hover, #eef1f4);
}

.phone-inline-list {
  overflow-y: auto;
  max-height: 34vh;
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.phone-inline .row-item {
  border-radius: 10px;
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

.phone-inline .phone-result-title {
  margin: 0;
}
</style>
