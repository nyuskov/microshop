<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'
import { useAuthStore, type AuthSession as AuthSessionRow } from '@/stores/auth'
import { getErrorMessage } from '@/services/errors'
import { removeAvatar, uploadAvatar } from '@/services/api'
import { mediaUrl } from '@/services/chatService'
import { formatPhoneForBackend, localPhoneDigits, maskPhoneLocal } from '@/utils/phone'
import { avatarStyle as userAvatarStyle, initials as userInitials } from '@/utils/user'
import { disablePushNotifications, enablePushNotifications } from '@/services/pwa'
import { disableNativePush, enableNativePush, isNativeApp } from '@/services/nativePush'
import { fetchStorageInfo, formatBytes, type StorageInfo } from '@/services/storage'
import {
  deviceLabelOf,
  fetchSecurityLog,
  formatEventTime,
  isAlertEvent,
  type SecurityLogEntry
} from '@/services/securityLog'
import { PASSWORD_MIN_LENGTH, passwordProblem, passwordStrength } from '@/utils/passwordPolicy'
import DeleteAccountDialog from '@/components/messenger/DeleteAccountDialog.vue'

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
  status: string
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
  status: '',
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
    profileForm.phone_number = user.phone_number ? formatPhoneForBackend(user.phone_number) : ''
    profileForm.email = user.email ?? ''
    profileForm.status = user.status ?? ''
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

const heroInitials = computed(() => userInitials(heroName.value))

const avatarStyle = computed(() => userAvatarStyle(heroName.value))

// ---------- Сохранение ----------
const saving = ref(false)
const success = ref(false)
const errorMessage = ref('')

// ---------- Аватар ----------
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarUploading = ref(false)
const avatarError = ref('')

const avatarSrc = computed<string | null>(() => {
  const url = authStore.current_user?.avatar_url
  return url ? mediaUrl(url) : null
})

const hasAvatar = computed<boolean>(() => !!authStore.current_user?.avatar_url)

const onAvatarSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!file.type.startsWith('image/')) {
    avatarError.value = 'Пожалуйста, выберите изображение'
    return
  }

  avatarUploading.value = true
  avatarError.value = ''
  try {
    const url = await uploadAvatar(file)
    if (authStore.current_user) {
      authStore.current_user = { ...authStore.current_user, avatar_url: url }
    }
    await authStore.fetchUser()
  } catch (error) {
    avatarError.value = getErrorMessage(error, 'Не удалось загрузить фото')
  } finally {
    avatarUploading.value = false
  }
}

const removeAvatarClick = async () => {
  avatarUploading.value = true
  avatarError.value = ''
  try {
    await removeAvatar()
    if (authStore.current_user) {
      authStore.current_user = { ...authStore.current_user, avatar_url: null }
    }
    await authStore.fetchUser()
  } catch (error) {
    avatarError.value = getErrorMessage(error, 'Не удалось удалить фото')
  } finally {
    avatarUploading.value = false
  }
}

const closeModal = () => emit('close-modal')

// ---------- Хранилище: сколько медиа занимает аккаунт ----------
// Квота считается по файлам, которые пользователь загрузил сам (см.
// api_v1/media_quota.py): профиль показывает заполненность заранее, чтобы 413
// «хранилище заполнено» не стал неожиданностью.
const storageInfo = ref<StorageInfo | null>(null)
const storageLoading = ref(false)
/** Место почти закончилось — предупреждаем заранее (порог из настроек сервера). */
const STORAGE_WARN_PERCENT = 90
const storageWarn = computed(() => (storageInfo.value?.percent ?? 0) >= STORAGE_WARN_PERCENT)

const loadStorage = async () => {
  storageLoading.value = true
  try {
    storageInfo.value = await fetchStorageInfo()
  } catch (error) {
    console.error('Storage info failed:', error)
    storageInfo.value = null
  } finally {
    storageLoading.value = false
  }
}

void loadStorage()

// ---------- Журнал безопасности: что происходило с аккаунтом ----------
// Входы (в т.ч. неудачные), запросы кодов, подтверждение нового устройства,
// смена пароля/e-mail, отзыв сессий. Помогает разобрать инцидент: «кто-то заходил
// в мой аккаунт?», «когда сменили пароль?».
const securityLog = ref<SecurityLogEntry[]>([])
const securityLogLoading = ref(false)
const securityLogError = ref('')

const loadSecurityLog = async () => {
  securityLogLoading.value = true
  securityLogError.value = ''
  try {
    securityLog.value = await fetchSecurityLog(20)
  } catch (error) {
    console.error('Security log failed:', error)
    securityLogError.value = 'Не удалось загрузить историю действий.'
  } finally {
    securityLogLoading.value = false
  }
}

void loadSecurityLog()

// ---------- Безопасность: пароль, e-mail, выход со всех устройств ----------
// Уведомление показываем, если вход не защищён: пароля нет, пароль слабый
// (задан до появления политики) или не указан e-mail для восстановления.
const securityIssues = computed<string[]>(() => {
  const user = authStore.current_user
  if (!user) return []
  const issues: string[] = []
  if (!user.password_set) {
    issues.push('Задайте пароль — сейчас вход возможен только по коду в Telegram.')
  } else if (user.password_weak) {
    issues.push('Пароль слабый — замените его на длинную фразу.')
  }
  if (!user.email) {
    issues.push('Добавьте e-mail — он понадобится для восстановления доступа.')
  } else if (!user.email_verified && emailChannelAvailable.value) {
    issues.push(
      'Подтвердите e-mail — только подтверждённый адрес годится для входа и сброса пароля.'
    )
  }
  return issues
})

// --- Подтверждение e-mail: код из письма ---
const emailChannelAvailable = ref(false)
const emailCodeSent = ref(false)
const emailCodeInput = ref('')
const emailBusy = ref(false)
const emailNotice = ref('')
const emailError = ref('')

void authStore
  .fetchAuthChannels()
  .then((channels) => {
    emailChannelAvailable.value = channels.email_otp_available
  })
  .catch(() => {
    emailChannelAvailable.value = false
  })

const sendEmailCode = async () => {
  const address = (authStore.current_user?.email ?? profileForm.email).trim()
  if (!address) {
    emailError.value = 'Сначала укажите e-mail и сохраните профиль.'
    return
  }

  emailBusy.value = true
  emailError.value = ''
  emailNotice.value = ''
  try {
    const detail = await authStore.requestEmailVerification(address)
    emailCodeSent.value = true
    emailNotice.value = detail || 'Код отправлен на e-mail.'
  } catch (error) {
    emailError.value = getErrorMessage(error, 'Не удалось отправить код')
  } finally {
    emailBusy.value = false
  }
}

const confirmEmailCode = async () => {
  const address = (authStore.current_user?.email ?? profileForm.email).trim()
  if (!emailCodeInput.value.trim()) {
    emailError.value = 'Введите код из письма.'
    return
  }

  emailBusy.value = true
  emailError.value = ''
  emailNotice.value = ''
  try {
    await authStore.confirmEmailVerification(address, emailCodeInput.value.trim())
    emailCodeSent.value = false
    emailCodeInput.value = ''
    emailNotice.value =
      'E-mail подтверждён — теперь по нему можно входить и восстанавливать пароль.'
  } catch (error) {
    emailError.value = getErrorMessage(error, 'Неверный код из письма')
  } finally {
    emailBusy.value = false
  }
}

const passwordForm = reactive({
  current: '',
  next: '',
  confirm: ''
})
// Показ пароля («глазок») — отдельно по каждому полю.
const passwordVisible = reactive({ current: false, next: false, confirm: false })
const passwordSaving = ref(false)
const passwordNotice = ref('')
const passwordError = ref('')

const passwordHint = computed(() => {
  if (!passwordForm.next) return ''
  return passwordProblem(passwordForm.next, {
    phoneNumber: authStore.current_user?.phone_number,
    email: profileForm.email || authStore.current_user?.email,
    username: authStore.current_user?.username
  })
})

const passwordScore = computed(() => passwordStrength(passwordForm.next))

const resetPasswordForm = () => {
  passwordForm.current = ''
  passwordForm.next = ''
  passwordForm.confirm = ''
  passwordVisible.current = false
  passwordVisible.next = false
  passwordVisible.confirm = false
}

const changePassword = async () => {
  if (passwordSaving.value) return

  const problem = passwordProblem(passwordForm.next, {
    phoneNumber: authStore.current_user?.phone_number,
    email: profileForm.email || authStore.current_user?.email,
    username: authStore.current_user?.username
  })
  if (problem) {
    passwordError.value = problem
    passwordNotice.value = ''
    return
  }
  if (passwordForm.next !== passwordForm.confirm) {
    passwordError.value = 'Пароли не совпадают.'
    passwordNotice.value = ''
    return
  }

  passwordSaving.value = true
  passwordError.value = ''
  passwordNotice.value = ''
  try {
    const needsCurrent = authStore.current_user?.password_set === true
    await authStore.setPassword(passwordForm.next, needsCurrent ? passwordForm.current : undefined)
    await authStore.fetchUser()
    resetPasswordForm()
    passwordNotice.value = 'Пароль обновлён. Остальные устройства вышли из аккаунта.'
  } catch (error) {
    passwordError.value = getErrorMessage(error, 'Не удалось изменить пароль')
  } finally {
    passwordSaving.value = false
  }
}

const doRevokeAllSessions = async () => {
  if (passwordSaving.value) return

  passwordSaving.value = true
  passwordError.value = ''
  passwordNotice.value = ''
  try {
    await authStore.revokeAllSessions()
    await authStore.logout()
    emit('close-modal')
  } catch (error) {
    passwordError.value = getErrorMessage(error, 'Не удалось выйти на всех устройствах')
  } finally {
    passwordSaving.value = false
  }
}

// --- Активные входы (устройства): список + отзыв одного входа ---
// Показываем устройство, IP и время входа: так владелец видит чужие сессии.
// «Текущий» вход сервер определяет по отпечатку браузера/приложения (User-Agent).
const sessions = ref<AuthSessionRow[]>([])
const sessionsLoading = ref(false)
const sessionsError = ref('')
const sessionsNotice = ref('')

const loadSessions = async () => {
  sessionsLoading.value = true
  sessionsError.value = ''
  try {
    sessions.value = await authStore.fetchSessions()
  } catch (error) {
    sessionsError.value = getErrorMessage(error, 'Не удалось загрузить устройства')
  } finally {
    sessionsLoading.value = false
  }
}

void loadSessions()

const revokeSessionRow = async (row: AuthSessionRow) => {
  if (sessionsLoading.value) return
  sessionsLoading.value = true
  sessionsError.value = ''
  sessionsNotice.value = ''
  try {
    await authStore.revokeSession(row.id)
    if (row.current) {
      // Отозвали собственный вход — дальше работать нечем, выходим локально.
      await authStore.logout()
      emit('close-modal')
      return
    }
    sessions.value = sessions.value.filter((item) => item.id !== row.id)
    sessionsNotice.value = 'Устройство вышло из аккаунта.'
  } catch (error) {
    sessionsError.value = getErrorMessage(error, 'Не удалось отозвать устройство')
  } finally {
    sessionsLoading.value = false
  }
}

/** Короткая подпись устройства: браузер/ОС вместо полной строки User-Agent. */
const deviceLabel = (agent: string): string => {
  if (!agent) return 'Неизвестное устройство'
  if (/pismo/i.test(agent) && /android/i.test(agent)) return 'Pismo для Android'
  if (/edg\//i.test(agent)) return 'Microsoft Edge'
  if (/opr\//i.test(agent)) return 'Opera'
  if (/chrome\//i.test(agent) && !/chromium/i.test(agent)) return 'Chrome'
  if (/firefox\//i.test(agent)) return 'Firefox'
  if (/safari\//i.test(agent)) return 'Safari'
  return agent.slice(0, 48)
}

/** Операционная система по строке User-Agent (для подписи под устройством). */
const platformLabel = (agent: string): string => {
  if (/android/i.test(agent)) return 'Android'
  if (/(iphone|ipad|ipod)/i.test(agent)) return 'iOS'
  if (/windows/i.test(agent)) return 'Windows'
  if (/mac os x/i.test(agent)) return 'macOS'
  if (/linux/i.test(agent)) return 'Linux'
  return ''
}

/** Дата и время входа в читаемом виде. */
const sessionTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const doLogout = async () => {
  try {
    await authStore.logout()
  } finally {
    emit('close-modal')
  }
}

// ---------- Удаление аккаунта (требование RuStore/152-ФЗ) ----------
const showDeleteAccount = ref(false)

/** Аккаунт удалён на сервере: чистим локальную сессию и закрываем профиль. */
const onAccountDeleted = async () => {
  showDeleteAccount.value = false
  try {
    await authStore.logout()
  } finally {
    emit('close-modal')
  }
}

// ---------- Поле телефона (только для чтения) ----------
// Номер — это логин аккаунта: по нему выдаются коды входа, поэтому менять его
// из профиля нельзя (сервер тоже отклоняет такие запросы — 422).
const phoneFieldValue = computed<string>(() =>
  profileForm.phone_number ? maskPhoneLocal(localPhoneDigits(profileForm.phone_number)) : ''
)

const updateProfile = async () => {
  if (saving.value) return

  saving.value = true
  success.value = false
  errorMessage.value = ''

  const userData = {
    username: profileForm.username.trim(),
    first_name: profileForm.first_name.trim() || null,
    last_name: profileForm.last_name.trim() || null,
    email: profileForm.email.trim() || null,
    status: profileForm.status.trim() || null
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

// ---------- Уведомления: тумблер профиля управляет push-подпиской ----------
// В браузере это Web Push (разрешение браузера + подписка), в Android-приложении
// из RuStore — RuStore Push (разрешение Android + push-токен RuStore). Вызов идёт
// из клика по тумблеру = жест пользователя (обязателен на мобильных).
const onNotificationsToggle = async (val: boolean) => {
  if (val) {
    if (isNativeApp()) {
      enableNativePush()
      errorMessage.value = ''
      return
    }
    const res = await enablePushNotifications()
    if (res !== 'granted') {
      profileForm.notifications_enabled = false
      errorMessage.value =
        res === 'denied'
          ? 'Уведомления заблокированы браузером. Разрешите их в настройках сайта и попробуйте снова.'
          : res === 'unsupported'
            ? 'Push-уведомления недоступны: нужен HTTPS или localhost.'
            : 'Не удалось включить push-уведомления.'
    } else {
      errorMessage.value = ''
    }
  } else {
    errorMessage.value = ''
    if (isNativeApp()) {
      await disableNativePush()
      return
    }
    await disablePushNotifications()
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
        <div class="avatar-box">
          <button
            type="button"
            class="hero-avatar"
            :style="avatarStyle"
            :title="hasAvatar ? 'Изменить фото' : 'Загрузить фото'"
            :disabled="avatarUploading"
            @click="avatarInput?.click()"
          >
            <img v-if="avatarSrc" :src="avatarSrc" class="avatar-photo" alt="Аватар" />
            <template v-else>{{ heroInitials }}</template>
            <span class="avatar-camera"><q-icon name="photo_camera" size="15px" /></span>
          </button>
          <button
            v-if="hasAvatar"
            type="button"
            class="avatar-remove"
            title="Удалить фото"
            :disabled="avatarUploading"
            @click.stop="removeAvatarClick"
          >
            <q-icon name="close" size="15px" />
          </button>
          <input
            ref="avatarInput"
            class="hidden-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            @change="onAvatarSelected"
          />
        </div>
        <div class="hero-info">
          <h2 class="hero-name">{{ heroName }}</h2>
          <p class="hero-username">@{{ profileForm.username || 'username' }}</p>
          <p v-if="profileForm.status && profileForm.status.trim()" class="hero-status">
            {{ profileForm.status.trim() }}
          </p>
          <p v-if="profileForm.phone_number" class="hero-phone">
            <q-icon name="call" size="14px" /> {{ profileForm.phone_number }}
          </p>
          <p v-if="avatarUploading" class="avatar-status">
            <span class="mini-spinner"></span> Загрузка фото…
          </p>
          <p v-else-if="avatarError" class="avatar-status error">{{ avatarError }}</p>
        </div>
      </div>

      <form class="profile-form" @submit.prevent="updateProfile">
        <!-- Статус -->
        <section class="card-section">
          <h3 class="section-title">Статус</h3>
          <div class="field">
            <label for="pf-status">Ваш статус</label>
            <input
              id="pf-status"
              v-model="profileForm.status"
              type="text"
              maxlength="140"
              placeholder="Например: в работе 🚀"
            />
            <p class="field-hint">Показывается собеседнику в шапке личного чата.</p>
          </div>
        </section>

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
              <p class="field-hint">
                <template v-if="authStore.current_user?.email_verified">
                  <q-icon name="verified" size="14px" /> Подтверждён — можно входить по коду на
                  e-mail.
                </template>
                <template v-else-if="emailChannelAvailable">
                  Не подтверждён: подтвердите адрес, иначе войти по нему и восстановить пароль не
                  получится.
                </template>
                <template v-else> Не подтверждён (отправка писем на сервере выключена). </template>
              </p>
            </div>
          </div>
        </section>

        <!-- Контакты и локализация -->
        <section class="card-section">
          <h3 class="section-title">Контакты и локализация</h3>
          <div class="grid-2">
            <div class="field">
              <label for="pf-phone">Телефон</label>
              <input
                id="pf-phone"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                :value="phoneFieldValue"
                readonly
                aria-readonly="true"
                class="readonly-field"
              />
              <p class="field-hint">
                Это логин аккаунта, изменить номер нельзя. Нужен другой — напишите на
                nyuskov@gmail.com.
              </p>
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
              <span class="toggle-desc"
                >Системные push-уведомления, когда приложение свёрнуто или закрыто</span
              >
            </div>
            <q-toggle
              v-model="profileForm.notifications_enabled"
              color="primary"
              keep-color
              @update:model-value="onNotificationsToggle"
            />
          </div>
          <div class="toggle-row">
            <div class="toggle-text">
              <span class="toggle-name">Приватный режим</span>
              <span class="toggle-desc">Скрывать профиль от посторонних в поиске</span>
            </div>
            <q-toggle v-model="profileForm.privacy_mode" color="primary" keep-color />
          </div>
        </section>

        <!-- Хранилище: сколько медиа занимает аккаунт -->
        <section class="card-section">
          <h3 class="section-title">Хранилище</h3>
          <div v-if="storageInfo" class="storage-block">
            <div class="storage-line">
              <span class="storage-used">
                {{ formatBytes(storageInfo.used_bytes) }} из
                {{ formatBytes(storageInfo.quota_bytes) }}
              </span>
              <span class="storage-files">{{ storageInfo.files }} файл(ов)</span>
            </div>
            <div class="storage-bar" role="progressbar" :aria-valuenow="storageInfo.percent">
              <span
                class="storage-bar-fill"
                :class="{ warn: storageWarn }"
                :style="{ width: `${storageInfo.percent}%` }"
              ></span>
            </div>
            <p class="storage-hint" :class="{ warn: storageWarn }">
              <template v-if="storageWarn">
                <q-icon name="warning" size="16px" />
                Место почти закончилось: новые файлы не загрузятся — удалите старые сообщения с
                вложениями.
              </template>
              <template v-else>
                Пересланные файлы не тратят место второй раз. Освобождается сразу после удаления
                сообщения.
              </template>
            </p>
            <button
              type="button"
              class="storage-refresh"
              :disabled="storageLoading"
              @click="loadStorage"
            >
              <q-icon name="refresh" size="15px" /> Обновить
            </button>
          </div>
          <p v-else class="storage-hint">
            {{ storageLoading ? 'Загружаем…' : 'Не удалось получить данные хранилища.' }}
          </p>
        </section>

        <!-- Безопасность: пароль и сессии -->
        <section class="section security-section">
          <h3 class="section-title">Безопасность</h3>

          <div v-if="securityIssues.length" class="security-alert">
            <q-icon name="shield" size="18px" />
            <div>
              <strong>Аккаунт стоит защитить</strong>
              <ul>
                <li v-for="issue in securityIssues" :key="issue">{{ issue }}</li>
              </ul>
            </div>
          </div>

          <p class="security-hint">
            Вход — по номеру телефона. Пароль нужен, чтобы входить без кода в Telegram; минимум
            {{ PASSWORD_MIN_LENGTH }} символов, лучше — длинная фраза.
          </p>

          <!-- Подтверждение e-mail: код из письма (канал входа и сброса пароля) -->
          <div v-if="emailChannelAvailable" class="email-verify">
            <div class="email-verify-text">
              <strong>
                {{
                  authStore.current_user?.email_verified
                    ? 'E-mail подтверждён'
                    : 'Подтверждение e-mail'
                }}
              </strong>
              <span>
                {{
                  authStore.current_user?.email_verified
                    ? 'По нему можно войти без пароля и восстановить доступ.'
                    : 'Без подтверждения адрес не годится для входа и восстановления пароля.'
                }}
              </span>
            </div>

            <template v-if="!authStore.current_user?.email_verified">
              <div class="email-verify-actions">
                <button
                  type="button"
                  class="revoke-btn"
                  :disabled="emailBusy"
                  @click="sendEmailCode"
                >
                  <q-icon name="forward_to_inbox" size="17px" />
                  {{ emailCodeSent ? 'Отправить код ещё раз' : 'Отправить код на e-mail' }}
                </button>

                <div v-if="emailCodeSent" class="email-code-row">
                  <input
                    v-model="emailCodeInput"
                    inputmode="numeric"
                    maxlength="6"
                    placeholder="Код из письма"
                    aria-label="Код из письма"
                    @keyup.enter="confirmEmailCode"
                  />
                  <button
                    type="button"
                    class="security-btn"
                    :disabled="emailBusy"
                    @click="confirmEmailCode"
                  >
                    Подтвердить
                  </button>
                </div>
              </div>
            </template>

            <transition name="fade">
              <p v-if="emailNotice" class="email-note">{{ emailNotice }}</p>
            </transition>
            <transition name="fade">
              <p v-if="emailError" class="email-error">{{ emailError }}</p>
            </transition>
          </div>

          <form class="security-form" @submit.prevent="changePassword">
            <label v-if="authStore.current_user?.password_set" class="field-label" for="pf-current">
              Текущий пароль
            </label>
            <div v-if="authStore.current_user?.password_set" class="password-wrap">
              <input
                id="pf-current"
                v-model="passwordForm.current"
                :type="passwordVisible.current ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="Текущий пароль"
              />
              <button
                type="button"
                class="password-eye"
                :aria-label="passwordVisible.current ? 'Скрыть пароль' : 'Показать пароль'"
                @click="passwordVisible.current = !passwordVisible.current"
              >
                <q-icon
                  :name="passwordVisible.current ? 'visibility_off' : 'visibility'"
                  size="18px"
                />
              </button>
            </div>

            <label class="field-label" for="pf-new">Новый пароль</label>
            <div class="password-wrap">
              <input
                id="pf-new"
                v-model="passwordForm.next"
                :type="passwordVisible.next ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="Новый пароль"
              />
              <button
                type="button"
                class="password-eye"
                :aria-label="passwordVisible.next ? 'Скрыть пароль' : 'Показать пароль'"
                @click="passwordVisible.next = !passwordVisible.next"
              >
                <q-icon
                  :name="passwordVisible.next ? 'visibility_off' : 'visibility'"
                  size="18px"
                />
              </button>
            </div>
            <p v-if="passwordForm.next" class="password-meter" :data-score="passwordScore.score">
              <span class="password-meter-bar"
                ><span :style="{ width: `${passwordScore.score * 33}%` }"
              /></span>
              {{ passwordScore.label
              }}<template v-if="passwordHint"> — {{ passwordHint }}</template>
            </p>

            <label class="field-label" for="pf-confirm">Повторите пароль</label>
            <div class="password-wrap">
              <input
                id="pf-confirm"
                v-model="passwordForm.confirm"
                :type="passwordVisible.confirm ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="Повторите пароль"
              />
              <button
                type="button"
                class="password-eye"
                :aria-label="passwordVisible.confirm ? 'Скрыть пароль' : 'Показать пароль'"
                @click="passwordVisible.confirm = !passwordVisible.confirm"
              >
                <q-icon
                  :name="passwordVisible.confirm ? 'visibility_off' : 'visibility'"
                  size="18px"
                />
              </button>
            </div>

            <button type="submit" class="security-btn" :disabled="passwordSaving">
              <q-icon
                :name="authStore.current_user?.password_set ? 'lock_reset' : 'lock'"
                size="17px"
              />
              {{
                passwordSaving
                  ? 'Сохранение…'
                  : authStore.current_user?.password_set
                    ? 'Сменить пароль'
                    : 'Задать пароль'
              }}
            </button>

            <p class="security-note">
              После смены пароля все другие устройства выйдут из аккаунта.
            </p>
          </form>

          <transition name="fade">
            <div v-if="passwordNotice" class="notice success">
              <q-icon name="check_circle" size="18px" /> {{ passwordNotice }}
            </div>
          </transition>
          <transition name="fade">
            <div v-if="passwordError" class="notice error">
              <q-icon name="error" size="18px" /> {{ passwordError }}
            </div>
          </transition>

          <button
            type="button"
            class="revoke-btn"
            :disabled="passwordSaving"
            @click="doRevokeAllSessions"
          >
            <q-icon name="phonelink_erase" size="17px" />
            Выйти на всех устройствах
          </button>

          <!-- Активные входы: видно, где ещё открыт аккаунт -->
          <div class="sessions-block">
            <div class="sessions-head">
              <span class="sessions-title">Активные входы</span>
              <button
                type="button"
                class="sessions-refresh"
                :disabled="sessionsLoading"
                @click="loadSessions"
              >
                <q-icon name="refresh" size="16px" />
                Обновить
              </button>
            </div>

            <p v-if="sessionsLoading && !sessions.length" class="sessions-hint">
              Загружаем устройства…
            </p>
            <p v-else-if="!sessions.length && !sessionsError" class="sessions-hint">
              Активных входов не найдено.
            </p>

            <ul class="sessions-list">
              <li v-for="row in sessions" :key="row.id" class="session-row">
                <span class="session-icon">
                  <q-icon :name="row.current ? 'computer' : 'devices'" size="18px" />
                </span>
                <span class="session-info">
                  <span class="session-device">
                    {{ deviceLabel(row.device) }}
                    <span v-if="row.current" class="session-current">это устройство</span>
                  </span>
                  <span class="session-meta">
                    <template v-if="platformLabel(row.device)">
                      {{ platformLabel(row.device) }} ·
                    </template>
                    {{ sessionTime(row.created_at) }}
                    <template v-if="row.ip"> · IP {{ row.ip }}</template>
                  </span>
                </span>
                <button
                  type="button"
                  class="session-revoke"
                  :disabled="sessionsLoading"
                  :title="row.current ? 'Выйти на этом устройстве' : 'Завершить этот вход'"
                  @click="revokeSessionRow(row)"
                >
                  {{ row.current ? 'Выйти' : 'Завершить' }}
                </button>
              </li>
            </ul>

            <transition name="fade">
              <p v-if="sessionsNotice" class="sessions-note success-text">
                <q-icon name="check_circle" size="16px" /> {{ sessionsNotice }}
              </p>
            </transition>
            <transition name="fade">
              <p v-if="sessionsError" class="sessions-note error-text">
                <q-icon name="error" size="16px" /> {{ sessionsError }}
              </p>
            </transition>

            <p class="security-note">
              Вход с нового устройства требует код из письма, а о каждом таком входе мы сообщаем на
              подтверждённый e-mail.
            </p>
          </div>

          <!-- История событий аккаунта: ответ на «что происходило с аккаунтом» -->
          <div class="security-log">
            <div class="sessions-head">
              <span class="sessions-title">Последние действия</span>
              <button
                type="button"
                class="sessions-refresh"
                :disabled="securityLogLoading"
                @click="loadSecurityLog"
              >
                <q-icon name="refresh" size="16px" />
                Обновить
              </button>
            </div>

            <p v-if="securityLogLoading && !securityLog.length" class="sessions-hint">
              Загружаем историю…
            </p>
            <p v-else-if="!securityLog.length && !securityLogError" class="sessions-hint">
              Событий пока нет.
            </p>

            <ul class="sessions-list">
              <li
                v-for="entry in securityLog"
                :key="entry.id"
                class="session-row"
                :class="{ 'session-alert': isAlertEvent(entry.event) }"
              >
                <span class="session-icon">
                  <q-icon :name="isAlertEvent(entry.event) ? 'shield' : 'info'" size="18px" />
                </span>
                <span class="session-info">
                  <span class="session-device">{{ entry.title }}</span>
                  <span class="session-meta">
                    {{ formatEventTime(entry.created_at) }}
                    <template v-if="deviceLabelOf(entry.device)">
                      · {{ deviceLabelOf(entry.device) }}
                    </template>
                    <template v-if="entry.ip"> · IP {{ entry.ip }}</template>
                    <template v-if="entry.detail"> · {{ entry.detail }}</template>
                  </span>
                </span>
              </li>
            </ul>

            <p v-if="securityLogError" class="sessions-note error-text">
              <q-icon name="error" size="16px" /> {{ securityLogError }}
            </p>

            <p class="security-note">
              История хранится 180 дней и видна только вам. Если увидели незнакомый вход — смените
              пароль и нажмите «Выйти на всех устройствах».
            </p>
          </div>
        </section>

        <!-- Сообщения -->
        <transition name="fade">
          <div v-if="success" class="notice success">
            <q-icon name="check_circle" size="18px" /> Профиль сохранён
          </div>
        </transition>
        <transition name="fade">
          <div v-if="errorMessage" class="notice error">
            <q-icon name="error" size="18px" /> {{ errorMessage }}
          </div>
        </transition>

        <!-- Действия -->
        <div class="logout-row">
          <button type="button" class="logout-btn" :disabled="saving" @click="doLogout">
            <q-icon name="logout" size="17px" />
            Выйти из аккаунта
          </button>
        </div>

        <!-- Удаление аккаунта — требование RuStore и 152-ФЗ. -->
        <div class="delete-account-row">
          <button
            type="button"
            class="delete-account-btn"
            :disabled="saving"
            @click="showDeleteAccount = true"
          >
            <q-icon name="delete_forever" size="17px" />
            Удалить аккаунт
          </button>
          <p class="delete-account-hint">
            Аккаунт, переписка и вложения будут удалены безвозвратно.
          </p>
        </div>

        <!-- Документы: правила сообщества и политика (требования магазинов к UGC) -->
        <div class="legal-row">
          <a class="legal-link" href="/community.html" target="_blank" rel="noopener">
            <q-icon name="gavel" size="16px" />
            Правила сообщества
          </a>
          <a class="legal-link" href="/privacy.html" target="_blank" rel="noopener">
            <q-icon name="privacy_tip" size="16px" />
            Политика конфиденциальности
          </a>
          <a class="legal-link" href="/terms.html" target="_blank" rel="noopener">
            <q-icon name="description" size="16px" />
            Пользовательское соглашение
          </a>
        </div>

        <div class="form-actions">
          <button type="button" class="btn ghost" :disabled="saving" @click="closeModal">
            Отмена
          </button>
          <button type="submit" class="btn primary" :disabled="saving">
            <span v-if="saving" class="spinner light"></span>
            <q-icon v-else name="check" size="17px" />
            {{ saving ? 'Сохранение…' : 'Сохранить' }}
          </button>
        </div>
      </form>
    </template>

    <!-- Диалог удаления аккаунта (требование RuStore/152-ФЗ) -->
    <DeleteAccountDialog
      v-if="showDeleteAccount"
      @close="showDeleteAccount = false"
      @deleted="onAccountDeleted"
    />
  </div>
</template>

<style scoped>
.profile-sheet {
  color: #1c2733;
  font-family: var(--ms-font);
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
  border: none;
  cursor: pointer;
  overflow: hidden;
  position: relative;
  padding: 0;
  transition:
    box-shadow 0.2s,
    filter 0.2s;
}

.hero-avatar:hover:not(:disabled) {
  filter: brightness(1.04);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.18);
}

.hero-avatar:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.avatar-box {
  position: relative;
  flex-shrink: 0;
}

.avatar-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar-camera {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  pointer-events: none;
}

.avatar-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid #fff;
  background: #d64545;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  cursor: pointer;
  padding: 0;
  transition:
    transform 0.12s,
    background 0.2s;
}

.avatar-remove:hover:not(:disabled) {
  transform: scale(1.1);
  background: #c0392b;
}

.avatar-remove:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hidden-file {
  display: none;
}

.avatar-status {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: #2ea25e;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.avatar-status.error {
  color: #c0392b;
}

.mini-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(46, 162, 94, 0.3);
  border-top-color: #2ea25e;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
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

.hero-status {
  margin: 0 0 4px;
  color: #2ea25e;
  font-size: 13.5px;
  font-weight: 500;
  word-break: break-word;
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

.field-hint {
  margin: 0;
  font-size: 12px;
  color: #8a98a3;
}

/* Телефон — только для чтения: номер является логином аккаунта. */
.readonly-field {
  background: #f2f5f7 !important;
  color: #52626f !important;
  cursor: not-allowed;
}

.readonly-field:focus {
  border-color: #dfe5ea;
  box-shadow: none;
}

.field input,
.field textarea,
.field select {
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

.field input:focus,
.field textarea:focus,
.field select:focus {
  border-color: var(--ms-accent, #2ea25e);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ms-accent, #2ea25e) 15%, transparent);
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

/* Кнопки и уведомления */
.logout-row {
  display: flex;
  justify-content: flex-start;
}

/* Безопасность: пароль и сессии */
.security-section {
  gap: 10px;
}

.security-alert {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #f2d9a8;
  border-radius: 12px;
  background: #fffaf0;
  color: #8a6116;
  font-size: 13.5px;
}

.security-alert strong {
  display: block;
  margin-bottom: 4px;
  color: #7a5310;
}

.security-alert ul {
  margin: 0;
  padding-left: 18px;
}

.security-hint {
  margin: 0;
  font-size: 13px;
  color: #6b7b88;
}

.security-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.security-form input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e2e6ea;
  border-radius: 11px;
  background: #fff;
  font: inherit;
  font-size: 14.5px;
  color: #1c2733;
}

.security-form input:focus {
  outline: none;
  border-color: var(--ms-accent, #2ea25e);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ms-accent, #2ea25e) 15%, transparent);
}

.password-meter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 2px;
  font-size: 12.5px;
  color: #6b7b88;
}

.password-meter-bar {
  display: inline-block;
  width: 90px;
  height: 5px;
  border-radius: 999px;
  background: #e9edf0;
  overflow: hidden;
}

.password-meter-bar > span {
  display: block;
  height: 100%;
  background: #e0a800;
  transition: width 0.2s ease;
}

.password-meter[data-score='3'] .password-meter-bar > span {
  background: #2ea25e;
}

.security-btn,
.revoke-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 11px;
  font: inherit;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
}

.security-btn {
  align-self: flex-start;
  margin-top: 8px;
  border: none;
  background: var(--ms-accent, #2ea25e);
  color: #fff;
}

.revoke-btn {
  align-self: flex-start;
  margin-top: 4px;
  border: 1px solid #e2e6ea;
  background: #fff;
  color: #1c2733;
}

.security-btn:disabled,
.revoke-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.security-note {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: #8295a3;
}

/* Хранилище: индикатор заполненности квоты на медиа. */
.storage-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.storage-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.storage-used {
  font-size: 14px;
  font-weight: 600;
  color: #1c2733;
}

.storage-files {
  font-size: 12.5px;
  color: #8295a3;
}

.storage-bar {
  height: 8px;
  border-radius: 999px;
  background: #eef1f4;
  overflow: hidden;
}

.storage-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--ms-accent, #2ea25e);
  transition: width 0.3s ease;
}

.storage-bar-fill.warn {
  background: #e0a02a;
}

.storage-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12.5px;
  color: #8295a3;
}

.storage-hint.warn {
  color: #a5741a;
}

.storage-refresh {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--ms-accent, #2ea25e);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 0;
}

.storage-refresh:disabled {
  opacity: 0.55;
  cursor: default;
}

/* История событий аккаунта: строки с иконкой щита у «важных» событий. */
.security-log {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #eef1f4;
}

.session-row.session-alert .session-icon {
  background: rgba(224, 160, 42, 0.16);
  color: #a5741a;
}

/* Активные входы (устройства) — список с отзывом по одному. */
.sessions-block {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #eef1f4;
}

.sessions-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sessions-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c2733;
}

.sessions-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--ms-accent, #2ea25e);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 8px;
}

.sessions-refresh:disabled {
  opacity: 0.55;
  cursor: default;
}

.sessions-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: #8295a3;
}

.sessions-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #eef1f4;
  border-radius: 12px;
  background: #fafbfc;
}

.session-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ms-accent, #2ea25e) 12%, transparent);
  color: var(--ms-accent, #2ea25e);
  flex-shrink: 0;
}

.session-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.session-device {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #1c2733;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-current {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ms-accent, #2ea25e) 14%, transparent);
  color: var(--ms-accent, #2ea25e);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.session-meta {
  font-size: 12px;
  color: #8295a3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-revoke {
  flex-shrink: 0;
  border: 1px solid #e2e6ea;
  background: #fff;
  color: #b23b3b;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 9px;
  cursor: pointer;
}

.session-revoke:hover {
  border-color: #e6b7b7;
  background: #fdf5f5;
}

.session-revoke:disabled {
  opacity: 0.55;
  cursor: default;
}

.sessions-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  font-size: 13px;
}

.sessions-note.success-text {
  color: #1e9b51;
}

.sessions-note.error-text {
  color: #c0392b;
}

/* Подтверждение e-mail в разделе «Безопасность». */
.email-verify {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid #e2e6ea;
  border-radius: 12px;
  background: #f8fafb;
}

.email-verify-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13.5px;
  color: #1c2733;
}

.email-verify-text span {
  font-size: 12.5px;
  color: #6b7b88;
}

.email-verify-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.email-code-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.email-code-row input {
  flex: 1;
  min-width: 120px;
  padding: 9px 12px;
  border: 1px solid #e2e6ea;
  border-radius: 11px;
  background: #fff;
  font: inherit;
  font-size: 14.5px;
  color: #1c2733;
}

.email-code-row input:focus {
  outline: none;
  border-color: var(--ms-accent, #2ea25e);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ms-accent, #2ea25e) 15%, transparent);
}

.email-note {
  margin: 0;
  font-size: 12.5px;
  color: #2ea25e;
}

.email-error {
  margin: 0;
  font-size: 12.5px;
  color: #d64545;
}

.field-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #8295a3;
}

/* Поле пароля с «глазком»: кнопка лежит поверх инпута справа. */
.password-wrap {
  position: relative;
  display: flex;
}

.password-wrap input {
  padding-right: 42px;
}

.password-eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: #8295a3;
  cursor: pointer;
}

.password-eye:hover {
  background: #f1f4f6;
  color: #1c2733;
}

/* Удаление аккаунта (требование RuStore/152-ФЗ): заметно, но не кричит. */
.delete-account-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed #e2e6ea;
}

/* Ссылки на документы: правила сообщества и политика (требования магазинов). */
.legal-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 12px;
}

.legal-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ms-accent, #2ea25e);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.legal-link:hover {
  text-decoration: underline;
}

.delete-account-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid #f0c2c2;
  border-radius: 11px;
  background: #fff6f6;
  color: #c93b3b;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.delete-account-btn:hover:not(:disabled) {
  background: #fdeaea;
}

.delete-account-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.delete-account-hint {
  margin: 0;
  font-size: 12.5px;
  color: #8a949e;
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
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ms-accent, #2ea25e) 86%, #ffffff) 0%,
    var(--ms-accent, #2ea25e) 100%
  );
  color: #fff;
  box-shadow: 0 8px 18px color-mix(in srgb, var(--ms-accent, #2ea25e) 28%, transparent);
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
