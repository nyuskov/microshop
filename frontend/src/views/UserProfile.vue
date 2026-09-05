<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'
import InputMask from 'primevue/inputmask'
import { useAuthStore } from '@/stores/auth'
import { getErrorMessage } from '@/services/errors'

const emit = defineEmits(['close-modal'])

const authStore = useAuthStore()

const LANGUAGES = [
  { code: 'ru', name: 'Русский' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' }
]

const COUNTRIES = [
  { code: 'RU', name: 'Россия' },
  { code: 'BY', name: 'Беларусь' },
  { code: 'KZ', name: 'Казахстан' },
  { code: 'US', name: 'США' },
  { code: 'DE', name: 'Германия' },
  { code: 'ES', name: 'Испания' },
  { code: 'FR', name: 'Франция' }
]

interface ProfileForm {
  username: string
  first_name: string
  last_name: string
  phone_number: string
  email: string
  bio: string
  birth_date: string
  language: string
  country: string
  notifications_enabled: boolean
  privacy_mode: boolean
}

const profileForm = reactive<ProfileForm>({
  username: '',
  first_name: '',
  last_name: '',
  phone_number: '',
  email: '',
  bio: '',
  birth_date: '',
  language: '',
  country: '',
  notifications_enabled: true,
  privacy_mode: false
})

watch(
  () => authStore.current_user,
  (user) => {
    if (!user) return
    const profile = user.profile
    profileForm.username = user.username ?? ''
    profileForm.first_name = user.first_name ?? ''
    profileForm.last_name = user.last_name ?? ''
    profileForm.phone_number = user.phone_number ?? ''
    profileForm.email = user.email ?? ''
    profileForm.bio = profile?.bio ?? ''
    profileForm.birth_date = profile?.birth_date ?? ''
    profileForm.language = profile?.language ?? ''
    profileForm.country = profile?.country ?? ''
    profileForm.notifications_enabled = profile?.notifications_enabled ?? true
    profileForm.privacy_mode = profile?.privacy_mode ?? false
  },
  { immediate: true }
)

// ---------- Отображение ----------
const fullName = computed(() =>
  [profileForm.first_name, profileForm.last_name].filter(Boolean).join(' ').trim()
)

const heroName = computed(() => fullName.value || profileForm.username || 'Пользователь')

const heroInitials = computed(() => {
  const clean = heroName.value.trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase()
})

const AVATAR_COLORS = [
  'linear-gradient(135deg,#5b9bd5,#2e75b6)',
  'linear-gradient(135deg,#69b578,#2f8f5b)',
  'linear-gradient(135deg,#e58e7a,#c25e4a)',
  'linear-gradient(135deg,#b28ce0,#7c53b8)',
  'linear-gradient(135deg,#f0a35e,#d97b2b)',
  'linear-gradient(135deg,#6fc3c9,#2f9aa3)'
]

const avatarStyle = computed(() => {
  const name = heroName.value
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return { background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }
})

// ---------- Сохранение ----------
const saving = ref(false)
const success = ref(false)
const errorMessage = ref('')

const closeModal = () => emit('close-modal')

const doLogout = async () => {
  try {
    await authStore.logout()
  } finally {
    emit('close-modal')
  }
}

const updateProfile = async () => {
  if (saving.value) return
  saving.value = true
  success.value = false
  errorMessage.value = ''

  const userData = {
    username: profileForm.username.trim(),
    first_name: profileForm.first_name.trim() || null,
    last_name: profileForm.last_name.trim() || null,
    phone_number: profileForm.phone_number || null,
    email: profileForm.email.trim() || null
  }

  const profileData = {
    bio: profileForm.bio.trim() || null,
    birth_date: profileForm.birth_date || null,
    language: profileForm.language || null,
    country: profileForm.country || null,
    notifications_enabled: profileForm.notifications_enabled,
    privacy_mode: profileForm.privacy_mode
  }

  try {
    await authStore.updateCurrentUser({ ...userData, profile: profileData })
    await authStore.fetchUser()
    success.value = true
  } catch (error) {
    errorMessage.value = getErrorMessage(error, 'Не удалось сохранить профиль')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="profile-sheet">
    <div v-if="!authStore.current_user" class="loading-block">
      <span class="spinner"></span>
      <p>Загрузка профиля…</p>
    </div>

    <template v-else>
      <!-- Шапка профиля -->
      <div class="profile-hero">
        <div class="hero-avatar" :style="avatarStyle">{{ heroInitials }}</div>
        <div class="hero-info">
          <h2 class="hero-name">{{ heroName }}</h2>
          <p class="hero-username">@{{ profileForm.username || 'username' }}</p>
          <p v-if="profileForm.phone_number" class="hero-phone">
            <i class="pi pi-phone"></i> {{ profileForm.phone_number }}
          </p>
        </div>
      </div>

      <form class="profile-form" @submit.prevent="updateProfile">
        <!-- Основное -->
        <section class="card-section">
          <h3 class="section-title">О себе</h3>
          <div class="field">
            <label for="pf-bio">Биография</label>
            <textarea
              id="pf-bio"
              v-model="profileForm.bio"
              rows="3"
              placeholder="Расскажите немного о себе…"
            ></textarea>
          </div>
        </section>

        <!-- Имя -->
        <section class="card-section">
          <h3 class="section-title">Имя и фамилия</h3>
          <div class="grid-2">
            <div class="field">
              <label for="pf-first">Имя</label>
              <input id="pf-first" v-model="profileForm.first_name" type="text" placeholder="Имя" />
            </div>
            <div class="field">
              <label for="pf-last">Фамилия</label>
              <input
                id="pf-last"
                v-model="profileForm.last_name"
                type="text"
                placeholder="Фамилия"
              />
            </div>
            <div class="field">
              <label for="pf-username">Логин</label>
              <input
                id="pf-username"
                v-model="profileForm.username"
                type="text"
                placeholder="Логин"
              />
            </div>
            <div class="field">
              <label for="pf-email">Email</label>
              <input id="pf-email" v-model="profileForm.email" type="email" placeholder="Email" />
            </div>
          </div>
        </section>

        <!-- Контакты и локализация -->
        <section class="card-section">
          <h3 class="section-title">Контакты и локализация</h3>
          <div class="grid-2">
            <div class="field">
              <label for="pf-phone">Телефон</label>
              <InputMask
                id="pf-phone"
                v-model="profileForm.phone_number"
                mask="+7 (999) 999-99-99"
                class="native-like"
                placeholder="+7 (___) ___-__-__"
                :auto-clear="false"
              />
            </div>
            <div class="field">
              <label for="pf-birth">Дата рождения</label>
              <input id="pf-birth" v-model="profileForm.birth_date" type="date" />
            </div>
            <div class="field">
              <label for="pf-lang">Язык</label>
              <select id="pf-lang" v-model="profileForm.language">
                <option value="">Не выбран</option>
                <option v-for="lang in LANGUAGES" :key="lang.code" :value="lang.code">
                  {{ lang.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="pf-country">Страна</label>
              <select id="pf-country" v-model="profileForm.country">
                <option value="">Не выбрана</option>
                <option v-for="country in COUNTRIES" :key="country.code" :value="country.code">
                  {{ country.name }}
                </option>
              </select>
            </div>
          </div>
        </section>

        <!-- Настройки -->
        <section class="card-section">
          <h3 class="section-title">Настройки</h3>
          <div class="toggle-row">
            <div class="toggle-text">
              <span class="toggle-name">Уведомления о сообщениях</span>
              <span class="toggle-desc">Присылать оповещения о новых сообщениях</span>
            </div>
            <label class="switch">
              <input v-model="profileForm.notifications_enabled" type="checkbox" />
              <span class="slider"></span>
            </label>
          </div>
          <div class="toggle-row">
            <div class="toggle-text">
              <span class="toggle-name">Приватный режим</span>
              <span class="toggle-desc">Скрывать профиль от посторонних в поиске</span>
            </div>
            <label class="switch">
              <input v-model="profileForm.privacy_mode" type="checkbox" />
              <span class="slider"></span>
            </label>
          </div>
        </section>

        <!-- Сообщения -->
        <transition name="fade">
          <div v-if="success" class="notice success">
            <i class="pi pi-check-circle"></i> Профиль сохранён
          </div>
        </transition>
        <transition name="fade">
          <div v-if="errorMessage" class="notice error">
            <i class="pi pi-exclamation-circle"></i> {{ errorMessage }}
          </div>
        </transition>

        <!-- Действия -->
        <div class="logout-row">
          <button type="button" class="logout-btn" :disabled="saving" @click="doLogout">
            <i class="pi pi-sign-out"></i>
            Выйти из аккаунта
          </button>
        </div>

        <div class="form-actions">
          <button type="button" class="btn ghost" :disabled="saving" @click="closeModal">
            Отмена
          </button>
          <button type="submit" class="btn primary" :disabled="saving">
            <span v-if="saving" class="spinner light"></span>
            <template v-else><i class="pi pi-check"></i></template>
            {{ saving ? 'Сохранение…' : 'Сохранить' }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.profile-sheet {
  color: #1c2733;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.loading-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
  color: #71808d;
}

/* Шапка */
.profile-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 4px 2px 22px;
  border-bottom: 1px solid #eef1f3;
  margin-bottom: 18px;
}

.hero-avatar {
  width: 84px;
  height: 84px;
  border-radius: 28px;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.9rem;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.12);
}

.hero-info {
  min-width: 0;
}

.hero-name {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
  color: #141d26;
}

.hero-username {
  margin: 0 0 4px;
  color: #71808d;
  font-size: 14px;
}

.hero-phone {
  margin: 0;
  font-size: 13.5px;
  color: #4c6b5b;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hero-phone i {
  font-size: 0.85rem;
}

/* Секции-карточки */
.profile-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-section {
  background: #f7f9fb;
  border: 1px solid #e9edf0;
  border-radius: 16px;
  padding: 16px 18px;
}

.section-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #8295a3;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 12.5px;
  font-weight: 600;
  color: #52626f;
}

.field input,
.field textarea,
.field select,
.field :deep(.native-like),
.native-like {
  width: 100%;
  box-sizing: border-box;
  border: 1.5px solid #dfe5ea;
  border-radius: 11px;
  padding: 10px 12px;
  font-size: 14.5px;
  color: #141d26;
  background: #fff;
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  font-family: inherit;
}

.field :deep(.native-like) {
  background: #fff;
  border: 1.5px solid #dfe5ea;
}

.field input:focus,
.field textarea:focus,
.field select:focus,
.field :deep(.native-like:focus) {
  border-color: #2ea25e;
  box-shadow: 0 0 0 4px rgba(46, 162, 94, 0.13);
}

.field textarea {
  resize: vertical;
  min-height: 70px;
}

.field select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238295a3' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

/* Тумблеры */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 2px;
}

.toggle-row + .toggle-row {
  border-top: 1px solid #e9edf0;
}

.toggle-text {
  display: flex;
  flex-direction: column;
}

.toggle-name {
  font-size: 14.5px;
  font-weight: 600;
  color: #1c2733;
}

.toggle-desc {
  font-size: 12.5px;
  color: #8295a3;
  margin-top: 2px;
}

.switch {
  position: relative;
  width: 46px;
  height: 26px;
  flex-shrink: 0;
  cursor: pointer;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  inset: 0;
  background: #cdd6dd;
  border-radius: 26px;
  transition: background 0.2s;
}

.slider::before {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s;
}

.switch input:checked + .slider {
  background: #2ea25e;
}

.switch input:checked + .slider::before {
  transform: translateX(20px);
}

/* Кнопки и уведомления */
.logout-row {
  display: flex;
  justify-content: flex-start;
}

.logout-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #fdecec;
  color: #c0392b;
  border: none;
  border-radius: 11px;
  padding: 10px 14px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.logout-btn:hover:not(:disabled) {
  background: #f8d7d7;
}

.logout-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 6px;
}

.btn {
  border: none;
  border-radius: 12px;
  padding: 11px 18px;
  font-size: 14.5px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition:
    transform 0.12s,
    box-shadow 0.2s,
    background 0.2s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.primary {
  background: linear-gradient(135deg, #34c979 0%, #1e9b51 100%);
  color: #fff;
  box-shadow: 0 8px 18px rgba(30, 155, 81, 0.24);
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn.ghost {
  background: #fff;
  color: #52626f;
  border: 1.5px solid #dfe5ea;
}

.btn.ghost:hover:not(:disabled) {
  background: #f1f3f5;
}

.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13.5px;
  font-weight: 600;
}

.notice.success {
  background: #eaf7ee;
  color: #1e7a43;
}

.notice.error {
  background: #fdecec;
  color: #c0392b;
}

.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-top-color: #2ea25e;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.spinner.light {
  border-color: rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 560px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
