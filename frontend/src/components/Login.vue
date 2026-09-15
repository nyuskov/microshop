<script setup lang="ts">
import { icon } from '@/utils/icons'
import { useRouter } from 'vue-router'
import { useAuthStore, deviceChallengeOf, type DeviceChallenge } from '../stores/auth'
import { getErrorMessage } from '../services/errors'
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { formatPhoneForBackend, isValidPhoneNumber, prettyPhone } from '@/utils/phone'
import { PASSWORD_MIN_LENGTH, passwordProblem, passwordStrength } from '@/utils/passwordPolicy'
import PhoneInput from '@/components/common/PhoneInput.vue'
import ConsentCheckbox from '@/components/common/ConsentCheckbox.vue'

// Шаги входа: телефон → (пароль | код в Telegram | создание пароля), плюс
// отдельная ветка работы с e-mail: вход по коду из письма и сброс пароля.
// 'device' — подтверждение входа с нового устройства кодом из письма (2FA).
// 'unfreeze' — аккаунт заморожен (стоп-кран при угоне): доступ возвращаем кодом.
type LoginState = 'phone' | 'password' | 'otp' | 'create' | 'email' | 'device' | 'unfreeze'

const router = useRouter()
const authStore = useAuthStore()

const props = defineProps<{
  initialState?: LoginState
}>()

const emit = defineEmits<{
  'state-changed': [LoginState]
  'close-modal': []
  /** Номер подтверждён кодом — модалку нельзя закрывать до задания пароля. */
  'otp-verified': []
}>()

const state = ref<LoginState>('phone')

onMounted(() => {
  if (authStore.isAuthenticated) {
    emit('close-modal')
    return
  }

  if (props.initialState) {
    state.value = props.initialState
    emit('state-changed', state.value)
  }

  // Узнаём у сервера, включён ли канал писем: если нет — не показываем
  // кнопки «войти по e-mail» и «забыли пароль», чтобы не вести в тупик.
  void authStore
    .fetchAuthChannels()
    .then((channels) => {
      emailChannelAvailable.value = channels.email_otp_available
      registrationEnabled.value = channels.registration_enabled
    })
    .catch(() => {
      emailChannelAvailable.value = false
    })
})

const phoneOrUsername = ref('')
const password = ref('')
const passwordConfirm = ref('')
const passwordFieldRef = ref<HTMLInputElement | null>(null)
// Показ пароля («глазок») — отдельно по каждому полю, чтобы можно было
// подсмотреть только то, что нужно.
const showCurrent = ref(false)
const showNew = ref(false)
const showConfirm = ref(false)
/** Есть ли у номера уже заданный пароль (иначе — предлагаем создать). */
const hasPassword = ref(false)
/** Аккаунта ещё не существует (новый номер). */
const isNewNumber = ref(false)
/** Можно ли доставить код подтверждения на этот номер. */
const otpAvailable = ref(false)
/** Пароль задаётся сразу после подтверждения номера кодом. */
const afterOtp = ref(false)
const otpCode = ref('')
const otpFieldRef = ref<HTMLInputElement | null>(null)

// --- Согласие с правилами: спрашиваем там, где создаётся аккаунт ---
/** Галка «принимаю документы сервиса»: без неё аккаунт не создаём. */
const acceptRules = ref(false)
/** Галку не отметили там, где она обязательна — подсветить её. */
const consentError = ref(false)
/**
 * Нужна ли галка согласия на текущем шаге.
 *
 * Только там, где создаётся НОВЫЙ аккаунт: подтверждение кода на новом номере
 * (сервер заводит пользователя в `/auth/verify-otp/`) и ввод пароля для нового
 * номера. При обычном входе и при задании пароля уже существующему аккаунту
 * согласие не спрашиваем — аккаунт создан раньше, и лишняя галка на входе
 * только мешает.
 */
const consentRequired = computed(
  () =>
    (state.value === 'otp' && isNewNumber.value) ||
    (state.value === 'create' && isNewNumber.value && !afterOtp.value)
)

// --- E-mail: вход по коду из письма и восстановление пароля ---
const emailValue = ref('')
const emailCode = ref('')
const emailMode = ref<'login' | 'reset'>('login')
/** Код отправлен: показываем поле ввода кода (и пароль при сбросе). */
const emailCodeSent = ref(false)
/** Включён ли на сервере канал писем (SMTP). */
const emailChannelAvailable = ref(false)
/** Разрешена ли на сервере регистрация новых аккаунтов (временный рубильник). */
const registrationEnabled = ref(true)
const resetPassword = ref('')
const resetPasswordConfirm = ref('')
const showEmailCode = ref(false)
const showResetPassword = ref(false)

// --- 2FA: подтверждение входа с нового устройства ---
const deviceChallenge = ref<DeviceChallenge | null>(null)
const deviceCode = ref('')
const deviceFieldRef = ref<HTMLInputElement | null>(null)
const showDeviceCode = ref(false)
/** Куда вернуться кнопкой «назад» со шага подтверждения устройства. */
const previousDeviceState = ref<LoginState>('password')

const severity = ref<'success' | 'error' | 'info' | 'warn'>('success')
const result = ref('')
const isLoading = ref(false)

/** Показывать ли сообщение-уведомление (скрываем «штатные» успешные тексты). */
const showNotice = computed(() => !!result.value && result.value !== 'Вход успешен!')

async function continueWithPhone() {
  if (authStore.isAuthenticated) {
    emit('close-modal')
    return
  }

  if (!isValidPhoneNumber(phoneOrUsername.value)) {
    result.value = 'Введите корректный номер телефона в формате +7 (___) ___-__-__'
    severity.value = 'error'
    return
  }

  isLoading.value = true
  result.value = ''
  try {
    const phone = formatPhoneForBackend(phoneOrUsername.value)
    const status = await authStore.passwordStatus(phone)
    isNewNumber.value = !status.registered
    hasPassword.value = status.has_password
    otpAvailable.value = status.otp_available
    resetPasswordFields()
    otpCode.value = ''
    afterOtp.value = false

    if (!status.registered && !registrationEnabled.value) {
      result.value = 'Регистрация новых пользователей временно отключена. Попробуйте позже.'
      severity.value = 'error'
      return
    }

    if (status.has_password) {
      state.value = 'password'
      emit('state-changed', state.value)
      void nextTick(focusPassword)
      return
    }

    if (status.otp_available) {
      // Сначала подтверждаем номер кодом, а пароль задаём после него: дальше
      // вход будет по паролю и без SMS — так дешевле.
      state.value = 'otp'
      emit('state-changed', state.value)
      await sendOtp()
      return
    }

    state.value = 'create'
    emit('state-changed', state.value)
    void nextTick(focusPassword)
  } catch (error: unknown) {
    console.error('Password status failed:', error)
    result.value = getErrorMessage(error, 'Не удалось проверить номер.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

const focusPassword = () => {
  passwordFieldRef.value?.focus()
}

/** Оценка силы пароля для подсказки на шаге создания (проверки — на сервере). */
const createPasswordScore = computed(() => passwordStrength(password.value))

function resetPasswordFields() {
  password.value = ''
  passwordConfirm.value = ''
  showCurrent.value = false
  showNew.value = false
  showConfirm.value = false
}

async function onLoginSubmit() {
  if (authStore.isAuthenticated) {
    emit('close-modal')
    return
  }

  if (!password.value) {
    result.value = 'Введите пароль.'
    severity.value = 'error'
    return
  }

  isLoading.value = true
  result.value = ''
  try {
    await authStore.loginWithPassword(
      formatPhoneForBackend(phoneOrUsername.value),
      password.value,
      router
    )
    resetPasswordFields()
    phoneOrUsername.value = ''
    result.value = ''
    emit('close-modal')
  } catch (error: unknown) {
    if (startDeviceStep(error, 'password')) return
    console.error('Login failed:', error)
    result.value = getErrorMessage(error, 'Неверный номер или пароль.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

/**
 * Вход с нового устройства: сервер не выдал токены, а прислал код на почту
 * (ответ 428). Показываем шаг ввода кода; возвращает `true`, если шаг открыт.
 */
function startDeviceStep(error: unknown, from: LoginState): boolean {
  const challenge = deviceChallengeOf(error)
  if (!challenge?.challenge_token) {
    return false
  }
  deviceChallenge.value = challenge
  deviceCode.value = ''
  showDeviceCode.value = false
  previousDeviceState.value = from
  state.value = 'device'
  emit('state-changed', state.value)
  result.value = challenge.detail
  severity.value = 'info'
  void nextTick(() => deviceFieldRef.value?.focus())
  return true
}

/** Второй шаг входа с нового устройства: код из письма → токены. */
async function onDeviceSubmit() {
  if (isLoading.value) return
  const challenge = deviceChallenge.value
  if (!challenge?.challenge_token) {
    goBackFromDevice()
    return
  }
  const code = deviceCode.value.replace(/\D/g, '')
  if (code.length < 4) {
    result.value = 'Введите код из письма.'
    severity.value = 'error'
    return
  }

  isLoading.value = true
  result.value = ''
  try {
    await authStore.verifyDeviceLogin(challenge.challenge_token, code, router)
    deviceChallenge.value = null
    deviceCode.value = ''
    finishLogin()
  } catch (error: unknown) {
    console.error('Device verify failed:', error)
    result.value = getErrorMessage(error, 'Неверный или истёкший код. Попробуйте войти заново.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

/** Возврат с шага подтверждения (например, чтобы запросить код заново). */
function goBackFromDevice() {
  deviceChallenge.value = null
  deviceCode.value = ''
  result.value = ''
  state.value = previousDeviceState.value
  emit('state-changed', state.value)
}

/** Отправляет (или повторно отправляет) код подтверждения на текущий номер. */
async function sendOtp() {
  if (isLoading.value) return
  isLoading.value = true
  result.value = ''
  try {
    await authStore.requestOtp(formatPhoneForBackend(phoneOrUsername.value))
    result.value = `Код отправлен на ${prettyPhone(phoneOrUsername.value)}`
    severity.value = 'info'
    void nextTick(() => otpFieldRef.value?.focus())
  } catch (error: unknown) {
    console.error('Request OTP failed:', error)
    result.value = getErrorMessage(error, 'Не удалось отправить код.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

/** Завершает вход: чистит форму и просит родителя закрыть модалку. */
function finishLogin() {
  resetPasswordFields()
  otpCode.value = ''
  phoneOrUsername.value = ''
  result.value = ''
  emit('close-modal')
}

/**
 * Проверяет галку принятия правил перед созданием аккаунта.
 *
 * Возвращает `false` и показывает сообщение, если согласие не отмечено:
 * согласие на обработку персональных данных должно быть явным действием
 * человека, а не текстом под кнопкой.
 */
function requireConsent(): boolean {
  if (acceptRules.value) {
    consentError.value = false
    return true
  }
  consentError.value = true
  result.value = 'Отметьте согласие с правилами сервиса — без него аккаунт создать нельзя.'
  severity.value = 'error'
  return false
}

/**
 * Подтверждает номер кодом. После успеха пользователь уже авторизован, но если
 * пароля у него нет — переходим к шагу «придумайте пароль» (и не закрываем окно).
 */
async function onOtpSubmit() {
  if (isLoading.value) return
  if (isNewNumber.value && !requireConsent()) return
  const code = otpCode.value.replace(/\D/g, '')
  if (code.length < 4) {
    result.value = 'Введите код из сообщения.'
    severity.value = 'error'
    return
  }

  isLoading.value = true
  result.value = ''
  try {
    await authStore.loginWithOtp(
      formatPhoneForBackend(phoneOrUsername.value),
      code,
      null,
      acceptRules.value
    )
    emit('otp-verified')
    otpCode.value = ''
    if (hasPassword.value) {
      finishLogin()
      return
    }
    afterOtp.value = true
    password.value = ''
    passwordConfirm.value = ''
    state.value = 'create'
    emit('state-changed', state.value)
    void nextTick(focusPassword)
  } catch (error: unknown) {
    if (startDeviceStep(error, 'otp')) return
    console.error('Verify OTP failed:', error)
    result.value = getErrorMessage(error, 'Неверный или истёкший код.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

async function onCreateSubmit() {
  if (authStore.isAuthenticated) {
    emit('close-modal')
    return
  }

  // Галка нужна только при создании нового аккаунта (см. `consentRequired`).
  if (consentRequired.value && !requireConsent()) return

  // Та же политика, что на сервере (см. utils/passwordPolicy.ts): длина,
  // чёрный список частых паролей, запрет данных аккаунта.
  const problem = passwordProblem(password.value, {
    phoneNumber: formatPhoneForBackend(phoneOrUsername.value),
    username: phoneOrUsername.value
  })
  if (problem) {
    result.value = problem
    severity.value = 'error'
    return
  }
  if (password.value !== passwordConfirm.value) {
    result.value = 'Пароли не совпадают.'
    severity.value = 'error'
    return
  }

  isLoading.value = true
  result.value = ''
  try {
    if (afterOtp.value) {
      // Номер уже подтверждён кодом — сессия есть, просто задаём пароль.
      await authStore.setPassword(password.value)
    } else {
      await authStore.registerWithPassword(
        formatPhoneForBackend(phoneOrUsername.value),
        password.value,
        router,
        acceptRules.value
      )
    }
    finishLogin()
  } catch (error: unknown) {
    if (startDeviceStep(error, 'create')) return
    console.error('Create password failed:', error)
    result.value = getErrorMessage(error, 'Не удалось создать пароль.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

function goBackToPhoneInput() {
  state.value = 'phone'
  emit('state-changed', state.value)
  resetPasswordFields()
  otpCode.value = ''
  afterOtp.value = false
  // Согласие относится к конкретной попытке регистрации: вернулись к номеру —
  // спрашиваем заново.
  acceptRules.value = false
  consentError.value = false
  result.value = ''
}

// --- E-mail: вход по коду из письма и восстановление пароля ---------------

/** Открывает шаг работы с e-mail: вход по коду либо сброс пароля. */
function openEmailStep(mode: 'login' | 'reset') {
  emailMode.value = mode
  emailValue.value = ''
  emailCode.value = ''
  resetPassword.value = ''
  resetPasswordConfirm.value = ''
  emailCodeSent.value = false
  result.value = ''
  state.value = 'email'
  emit('state-changed', state.value)
}

/** Отправляет код на указанный адрес (письмо уходит только на подтверждённый). */
async function sendEmailCode() {
  if (isLoading.value) return
  if (!emailValue.value.trim()) {
    result.value = 'Введите e-mail.'
    severity.value = 'error'
    return
  }

  isLoading.value = true
  result.value = ''
  try {
    const detail =
      emailMode.value === 'login'
        ? await authStore.requestEmailLogin(emailValue.value.trim())
        : await authStore.requestPasswordReset(emailValue.value.trim())
    emailCodeSent.value = true
    result.value = detail || 'Код отправлен на e-mail.'
    severity.value = 'info'
  } catch (error: unknown) {
    console.error('Request email code failed:', error)
    result.value = getErrorMessage(error, 'Не удалось отправить код на e-mail.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

/** Подтверждает код: вход без пароля либо смена пароля. */
async function onEmailSubmit() {
  if (isLoading.value) return
  const code = emailCode.value.replace(/\D/g, '')
  if (!emailCodeSent.value) {
    await sendEmailCode()
    return
  }
  if (code.length < 4) {
    result.value = 'Введите код из письма.'
    severity.value = 'error'
    return
  }

  if (emailMode.value === 'reset') {
    const problem = passwordProblem(resetPassword.value, {
      email: emailValue.value.trim()
    })
    if (problem) {
      result.value = problem
      severity.value = 'error'
      return
    }
    if (resetPassword.value !== resetPasswordConfirm.value) {
      result.value = 'Пароли не совпадают.'
      severity.value = 'error'
      return
    }
  }

  isLoading.value = true
  result.value = ''
  try {
    if (emailMode.value === 'login') {
      await authStore.confirmEmailLogin(emailValue.value.trim(), code, router)
      finishLogin()
      emit('close-modal')
    } else {
      await authStore.confirmPasswordReset(
        emailValue.value.trim(),
        code,
        resetPassword.value,
        router
      )
      finishLogin()
      emit('close-modal')
    }
  } catch (error: unknown) {
    console.error('Confirm email code failed:', error)
    result.value = getErrorMessage(error, 'Неверный или истёкший код из письма.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

const resetPasswordScore = computed(() => passwordStrength(resetPassword.value))

// --- Заморозка аккаунта: возвращаем доступ кодом из письма ---
// Экран показываем, когда сервер сообщил о заморозке (403 account_frozen):
// обычные шаги входа тут не помогут — аккаунт закрыт до подтверждения почты.
const unfreezeEmail = ref('')
const unfreezeCode = ref('')
const unfreezeSent = ref(false)
const unfreezeBusy = ref(false)
const unfreezeError = ref('')

watch(
  () => authStore.frozen,
  (frozen) => {
    if (!frozen) return
    state.value = 'unfreeze'
    if (!unfreezeEmail.value && emailValue.value) unfreezeEmail.value = emailValue.value
    emit('state-changed', state.value)
  },
  { immediate: true }
)

/** Код на подтверждённый e-mail: единственный способ разморозить аккаунт. */
const requestUnfreeze = async () => {
  if (unfreezeBusy.value) return
  unfreezeBusy.value = true
  unfreezeError.value = ''
  try {
    await authStore.requestAccountUnfreeze(unfreezeEmail.value)
    unfreezeSent.value = true
  } catch (error: unknown) {
    console.error('Request unfreeze failed:', error)
    unfreezeError.value = getErrorMessage(error, 'Не удалось отправить код на этот адрес.')
  } finally {
    unfreezeBusy.value = false
  }
}

/** Разморозка кодом из письма: аккаунт снова активен, входим на этом устройстве. */
const confirmUnfreeze = async () => {
  if (unfreezeBusy.value) return
  unfreezeBusy.value = true
  unfreezeError.value = ''
  try {
    await authStore.confirmAccountUnfreeze(unfreezeEmail.value, unfreezeCode.value, router)
    finishLogin()
    emit('close-modal')
  } catch (error: unknown) {
    console.error('Confirm unfreeze failed:', error)
    unfreezeError.value = getErrorMessage(error, 'Неверный или истёкший код из письма.')
  } finally {
    unfreezeBusy.value = false
  }
}

/** Уходим с экрана заморозки — например, чтобы войти в другой аккаунт. */
const leaveFrozen = () => {
  authStore.frozen = false
  unfreezeSent.value = false
  unfreezeCode.value = ''
  state.value = 'phone'
  emit('state-changed', state.value)
}
</script>

<template>
  <div class="login-modal">
    <transition name="fade" mode="out-in">
      <!-- Шаг заморозки аккаунта: все сессии завершены, вход закрыт -->
      <div v-if="state === 'unfreeze'" key="unfreeze" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon :name="icon('lock')" size="30px" /></span>
        </div>
        <h2 class="step-title">Аккаунт заморожен</h2>
        <p class="step-subtitle">
          Все устройства вышли из аккаунта, вход закрыт — так работает защита от угона. Вернуть
          доступ можно кодом на подтверждённый e-mail аккаунта.
        </p>

        <form
          class="otp-form"
          @submit.prevent="unfreezeSent ? confirmUnfreeze() : requestUnfreeze()"
        >
          <label class="field-label" for="unfreeze-email">E-mail аккаунта</label>
          <q-input
            for="unfreeze-email"
            v-model="unfreezeEmail"
            type="email"
            outlined
            class="phone-input"
            placeholder="name@example.com"
            autocomplete="email"
            aria-label="E-mail аккаунта"
            :disable="unfreezeSent"
            hide-bottom-space
          />

          <template v-if="unfreezeSent">
            <label class="field-label gap-top" for="unfreeze-code">Код из письма</label>
            <q-input
              for="unfreeze-code"
              v-model="unfreezeCode"
              outlined
              class="phone-input"
              placeholder="6 цифр"
              inputmode="numeric"
              autocomplete="one-time-code"
              aria-label="Код из письма"
              hide-bottom-space
            />
          </template>

          <q-btn
            unelevated
            no-caps
            color="primary"
            type="submit"
            class="submit-btn full"
            :loading="unfreezeBusy"
            :disable="unfreezeBusy"
          >
            {{ unfreezeSent ? 'Разморозить аккаунт' : 'Отправить код' }}
          </q-btn>
        </form>

        <transition name="fade">
          <div v-if="unfreezeError" class="login-message msg-error" role="alert">
            {{ unfreezeError }}
          </div>
        </transition>

        <p class="privacy-note">
          Нет доступа к почте аккаунта? Напишите на
          <a href="mailto:nyuskov@gmail.com">nyuskov@gmail.com</a> — вернём доступ вручную.
        </p>
        <button class="link-btn" type="button" :disabled="unfreezeBusy" @click="leaveFrozen">
          Войти в другой аккаунт
        </button>
      </div>

      <!-- Шаг 1: номер телефона -->
      <div v-else-if="state === 'phone'" key="phone" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon :name="icon('call')" size="30px" /></span>
        </div>
        <h2 class="step-title">Вход</h2>
        <p class="step-subtitle">Введите номер телефона — войдёте по паролю.</p>

        <label class="field-label" for="phone-input">Номер телефона</label>
        <PhoneInput
          id="phone-input"
          v-model="phoneOrUsername"
          placeholder="+7 (___) ___-__-__"
          aria-label="Номер телефона"
          @enter="continueWithPhone"
        />

        <button class="btn btn-primary" :disabled="isLoading" @click="continueWithPhone">
          <span v-if="isLoading" class="spinner"></span>
          <q-icon v-else :name="icon('arrow_forward')" size="17px" />
          <span>{{ isLoading ? 'Проверка…' : 'Продолжить' }}</span>
        </button>

        <p class="privacy-hint">
          Если пароля ещё нет — подтвердим номер кодом в Telegram и предложим его создать.
        </p>

        <button
          v-if="emailChannelAvailable"
          class="link-btn"
          type="button"
          :disabled="isLoading"
          @click="openEmailStep('login')"
        >
          <q-icon :name="icon('mail')" size="17px" />
          Войти по коду на e-mail
        </button>
      </div>

      <!-- Шаг 2а: ввод пароля (номер уже зарегистрирован) -->
      <div v-else-if="state === 'password'" key="password" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon :name="icon('lock')" size="30px" /></span>
        </div>
        <h2 class="step-title">Введите пароль</h2>
        <p class="step-subtitle">
          Для номера
          <strong>{{ prettyPhone(phoneOrUsername) }}</strong>
          уже задан пароль.
        </p>

        <form class="otp-form" @submit.prevent="onLoginSubmit">
          <label class="field-label" for="password-input">Пароль</label>
          <q-input
            for="password-input"
            ref="passwordFieldRef"
            v-model="password"
            :type="showCurrent ? 'text' : 'password'"
            outlined
            class="phone-input"
            placeholder="Введите пароль"
            autocomplete="current-password"
            aria-label="Пароль"
            hide-bottom-space
          >
            <template #append>
              <q-icon
                :name="icon(showCurrent ? 'visibility_off' : 'visibility')"
                class="password-eye"
                size="20px"
                role="button"
                :aria-label="showCurrent ? 'Скрыть пароль' : 'Показать пароль'"
                @click="showCurrent = !showCurrent"
              />
            </template>
          </q-input>

          <button type="submit" class="btn btn-primary" :disabled="isLoading">
            <span v-if="isLoading" class="spinner"></span>
            <q-icon v-else :name="icon('check')" size="17px" />
            <span>{{ isLoading ? 'Вход…' : 'Войти' }}</span>
          </button>
        </form>

        <button class="link-btn" type="button" :disabled="isLoading" @click="goBackToPhoneInput">
          <q-icon :name="icon('arrow_back')" size="17px" />
          Изменить номер
        </button>

        <button
          v-if="emailChannelAvailable"
          class="link-btn"
          type="button"
          :disabled="isLoading"
          @click="openEmailStep('reset')"
        >
          <q-icon :name="icon('help_outline')" size="17px" />
          Забыли пароль?
        </button>
      </div>

      <!-- Шаг 2в: подтверждение входа с нового устройства (2FA кодом из письма) -->
      <div v-else-if="state === 'device'" key="device" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon :name="icon('phonelink_lock')" size="30px" /></span>
        </div>
        <h2 class="step-title">Новое устройство</h2>
        <p class="step-subtitle">
          Вход с этого устройства выполняется впервые. Введите код из письма
          <template v-if="deviceChallenge?.code_sent_to">
            (отправлен на <strong>{{ deviceChallenge.code_sent_to }}</strong
            >)
          </template>
          — так мы убедимся, что это вы.
        </p>

        <form class="otp-form" @submit.prevent="onDeviceSubmit">
          <label class="field-label" for="device-code-input">Код из письма</label>
          <q-input
            for="device-code-input"
            ref="deviceFieldRef"
            v-model="deviceCode"
            :type="showDeviceCode ? 'text' : 'password'"
            inputmode="numeric"
            outlined
            class="phone-input otp-input"
            placeholder="_ _ _ _ _ _"
            autocomplete="one-time-code"
            aria-label="Код подтверждения из письма"
            hide-bottom-space
          >
            <template #append>
              <q-icon
                :name="icon(showDeviceCode ? 'visibility_off' : 'visibility')"
                class="password-eye"
                size="20px"
                role="button"
                :aria-label="showDeviceCode ? 'Скрыть код' : 'Показать код'"
                @click="showDeviceCode = !showDeviceCode"
              />
            </template>
          </q-input>

          <button type="submit" class="btn btn-primary" :disabled="isLoading">
            <span v-if="isLoading" class="spinner"></span>
            <q-icon v-else :name="icon('check')" size="17px" />
            <span>{{ isLoading ? 'Проверка…' : 'Подтвердить вход' }}</span>
          </button>
        </form>

        <p class="privacy-hint">
          Код не пришёл? Проверьте папку «Спам». Отправить письмо ещё раз можно, войдя заново — если
          прошла минута с прошлой отправки, придёт новый код, иначе действует предыдущий.
        </p>

        <button class="link-btn" type="button" :disabled="isLoading" @click="goBackFromDevice">
          <q-icon :name="icon('arrow_back')" size="17px" />
          Вернуться
        </button>
      </div>

      <!-- Шаг e-mail: вход по коду из письма и восстановление пароля -->
      <div v-else-if="state === 'email'" key="email" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon :name="icon('mail')" size="30px" /></span>
        </div>
        <h2 class="step-title">
          {{ emailMode === 'login' ? 'Вход по e-mail' : 'Восстановление пароля' }}
        </h2>
        <p class="step-subtitle">
          {{
            emailMode === 'login'
              ? 'Пришлём код на подтверждённый адрес аккаунта.'
              : 'Пришлём код на подтверждённый адрес, затем задайте новый пароль.'
          }}
        </p>

        <form class="otp-form" @submit.prevent="onEmailSubmit">
          <label class="field-label" for="email-input">E-mail</label>
          <q-input
            for="email-input"
            v-model="emailValue"
            type="email"
            outlined
            class="phone-input"
            placeholder="name@example.com"
            autocomplete="email"
            aria-label="E-mail"
            :disable="emailCodeSent"
            hide-bottom-space
          />

          <template v-if="emailCodeSent">
            <label class="field-label gap-top" for="email-code-input">Код из письма</label>
            <q-input
              for="email-code-input"
              v-model="emailCode"
              :type="showEmailCode ? 'text' : 'password'"
              inputmode="numeric"
              outlined
              class="phone-input"
              placeholder="6 цифр"
              autocomplete="one-time-code"
              aria-label="Код из письма"
              hide-bottom-space
            >
              <template #append>
                <q-icon
                  :name="icon(showEmailCode ? 'visibility_off' : 'visibility')"
                  class="password-eye"
                  size="20px"
                  role="button"
                  :aria-label="showEmailCode ? 'Скрыть код' : 'Показать код'"
                  @click="showEmailCode = !showEmailCode"
                />
              </template>
            </q-input>

            <template v-if="emailMode === 'reset'">
              <label class="field-label gap-top" for="reset-password-input">Новый пароль</label>
              <q-input
                for="reset-password-input"
                v-model="resetPassword"
                :type="showResetPassword ? 'text' : 'password'"
                outlined
                class="phone-input"
                :placeholder="`Не короче ${PASSWORD_MIN_LENGTH} символов`"
                autocomplete="new-password"
                aria-label="Новый пароль"
                hide-bottom-space
              >
                <template #append>
                  <q-icon
                    :name="icon(showResetPassword ? 'visibility_off' : 'visibility')"
                    class="password-eye"
                    size="20px"
                    role="button"
                    :aria-label="showResetPassword ? 'Скрыть пароль' : 'Показать пароль'"
                    @click="showResetPassword = !showResetPassword"
                  />
                </template>
              </q-input>

              <p v-if="resetPassword" class="password-meter" :data-score="resetPasswordScore.score">
                <span class="password-meter-bar"
                  ><span :style="{ width: `${resetPasswordScore.score * 33}%` }"
                /></span>
                {{ resetPasswordScore.label }}
              </p>

              <label class="field-label gap-top" for="reset-password-confirm">
                Повторите пароль
              </label>
              <q-input
                for="reset-password-confirm"
                v-model="resetPasswordConfirm"
                :type="showResetPassword ? 'text' : 'password'"
                outlined
                class="phone-input"
                placeholder="Повторите пароль"
                autocomplete="new-password"
                aria-label="Повтор нового пароля"
                hide-bottom-space
              />
            </template>
          </template>

          <button type="submit" class="btn btn-primary" :disabled="isLoading">
            <span v-if="isLoading" class="spinner"></span>
            <q-icon v-else :name="icon(emailCodeSent ? 'check' : 'send')" size="17px" />
            <span>{{ emailCodeSent ? 'Подтвердить' : 'Отправить код' }}</span>
          </button>
        </form>

        <button
          v-if="emailCodeSent"
          class="link-btn"
          type="button"
          :disabled="isLoading"
          @click="sendEmailCode"
        >
          <q-icon :name="icon('refresh')" size="17px" />
          Отправить код ещё раз
        </button>

        <button class="link-btn" type="button" :disabled="isLoading" @click="goBackToPhoneInput">
          <q-icon :name="icon('arrow_back')" size="17px" />
          Вернуться к входу по номеру
        </button>
      </div>

      <!-- Шаг 2б: подтверждение номера кодом (если пароля ещё нет) -->
      <div v-else-if="state === 'otp'" key="otp" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon :name="icon('sms')" size="30px" /></span>
        </div>
        <h2 class="step-title">Введите код</h2>
        <p class="step-subtitle">
          Код подтверждения отправлен в <strong>Telegram</strong> на номер
          <strong>{{ prettyPhone(phoneOrUsername) }}</strong
          >.
        </p>

        <form class="otp-form" @submit.prevent="onOtpSubmit">
          <label class="field-label" for="otp-input">Код из сообщения</label>
          <q-input
            for="otp-input"
            ref="otpFieldRef"
            v-model="otpCode"
            inputmode="numeric"
            maxlength="6"
            outlined
            class="phone-input"
            placeholder="6 цифр"
            autocomplete="one-time-code"
            aria-label="Код подтверждения"
            hide-bottom-space
          />

          <!-- Новый номер: подтверждение кода СРАЗУ создаёт аккаунт,
               поэтому согласие спрашиваем здесь, а не только на вводе пароля. -->
          <ConsentCheckbox v-if="consentRequired" v-model="acceptRules" :invalid="consentError" />

          <button type="submit" class="btn btn-primary" :disabled="isLoading">
            <span v-if="isLoading" class="spinner"></span>
            <q-icon v-else :name="icon('check')" size="17px" />
            <span>{{ isLoading ? 'Проверка…' : 'Подтвердить' }}</span>
          </button>
        </form>

        <button class="link-btn" type="button" :disabled="isLoading" @click="sendOtp">
          <q-icon :name="icon('refresh')" size="17px" />
          Отправить код ещё раз
        </button>

        <button class="link-btn" type="button" :disabled="isLoading" @click="goBackToPhoneInput">
          <q-icon :name="icon('arrow_back')" size="17px" />
          Изменить номер
        </button>

        <p class="privacy-hint">
          Код приходит в Telegram на этот номер. Нет Telegram или код не пришёл — напишите на
          nyuskov@gmail.com.
        </p>
      </div>

      <!-- Шаг 2в: создание пароля (новый номер или пароль ещё не задан) -->
      <div v-else key="create" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon :name="icon('person_add')" size="30px" /></span>
        </div>
        <h2 class="step-title">
          {{
            afterOtp ? 'Придумайте пароль' : isNewNumber ? 'Создание аккаунта' : 'Придумайте пароль'
          }}
        </h2>
        <p class="step-subtitle">
          {{
            afterOtp
              ? `Номер ${prettyPhone(phoneOrUsername)} подтверждён — задайте пароль, чтобы дальше входить без кода.`
              : isNewNumber
                ? `Номер ${prettyPhone(phoneOrUsername)} ещё не зарегистрирован — придумайте пароль.`
                : `Для номера ${prettyPhone(phoneOrUsername)} ещё нет пароля — задайте его.`
          }}
        </p>

        <form class="otp-form" @submit.prevent="onCreateSubmit">
          <label class="field-label" for="new-password-input">Пароль</label>
          <q-input
            for="new-password-input"
            ref="passwordFieldRef"
            v-model="password"
            :type="showNew ? 'text' : 'password'"
            outlined
            class="phone-input"
            :placeholder="`Не короче ${PASSWORD_MIN_LENGTH} символов`"
            autocomplete="new-password"
            aria-label="Новый пароль"
            hide-bottom-space
            @keyup.enter="onCreateSubmit"
          >
            <template #append>
              <q-icon
                :name="icon(showNew ? 'visibility_off' : 'visibility')"
                class="password-eye"
                size="20px"
                role="button"
                :aria-label="showNew ? 'Скрыть пароль' : 'Показать пароль'"
                @click="showNew = !showNew"
              />
            </template>
          </q-input>

          <p v-if="password" class="password-meter" :data-score="createPasswordScore.score">
            <span class="password-meter-bar"
              ><span :style="{ width: `${createPasswordScore.score * 33}%` }"
            /></span>
            {{ createPasswordScore.label }}
          </p>

          <label class="field-label gap-top" for="confirm-password-input">Повторите пароль</label>
          <q-input
            for="confirm-password-input"
            v-model="passwordConfirm"
            :type="showConfirm ? 'text' : 'password'"
            outlined
            class="phone-input"
            placeholder="Повторите пароль"
            autocomplete="new-password"
            aria-label="Повтор пароля"
            hide-bottom-space
            @keyup.enter="onCreateSubmit"
          >
            <template #append>
              <q-icon
                :name="icon(showConfirm ? 'visibility_off' : 'visibility')"
                class="password-eye"
                size="20px"
                role="button"
                :aria-label="showConfirm ? 'Скрыть пароль' : 'Показать пароль'"
                @click="showConfirm = !showConfirm"
              />
            </template>
          </q-input>

          <!-- Согласие с документами сервиса: без галки аккаунт не создаётся. -->
          <ConsentCheckbox v-if="consentRequired" v-model="acceptRules" :invalid="consentError" />

          <button type="submit" class="btn btn-primary" :disabled="isLoading">
            <span v-if="isLoading" class="spinner"></span>
            <q-icon v-else :name="icon('check')" size="17px" />
            <span>{{
              isLoading
                ? 'Сохранение…'
                : afterOtp
                  ? 'Сохранить пароль и войти'
                  : 'Создать пароль и войти'
            }}</span>
          </button>
        </form>

        <button class="link-btn" type="button" :disabled="isLoading" @click="goBackToPhoneInput">
          <q-icon :name="icon('arrow_back')" size="17px" />
          Изменить номер
        </button>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="showNotice" class="login-message" :class="'msg-' + severity" role="alert">
        {{ result }}
      </div>
    </transition>

    <!-- Сервер завершил сессию (выход на всех устройствах / смена пароля):
         объясняем, почему выкинуло, — иначе это выглядит как сбой. -->
    <transition name="fade">
      <div
        v-if="authStore.sessionNotice && state !== 'unfreeze'"
        class="login-message msg-info"
        role="status"
      >
        {{ authStore.sessionNotice }}
      </div>
    </transition>

    <!-- Уведомление об обработке персональных данных (требование RuStore и 152-ФЗ).
         На шагах регистрации его заменяет обязательная галка согласия — повторять
         одно и то же дважды не нужно. -->
    <p v-if="!consentRequired" class="privacy-note">
      Продолжая, вы соглашаетесь с
      <a href="/privacy.html" target="_blank" rel="noopener">политикой конфиденциальности</a>,
      <a href="/terms.html" target="_blank" rel="noopener">пользовательским соглашением</a>,
      <a href="/community.html" target="_blank" rel="noopener">правилами сообщества</a>
      и обработкой персональных данных.
    </p>
  </div>
</template>

<style scoped>
.privacy-note {
  margin: 14px 4px 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ms-muted);
}

.privacy-note a {
  color: var(--ms-accent, var(--ms-accent));
  text-decoration: none;
}

.privacy-note a:hover {
  text-decoration: underline;
}

.login-modal {
  width: 100%;
  max-width: 460px;
  margin: 0 auto;
  padding: 8px 16px;
  box-sizing: border-box;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.brand {
  display: flex;
  justify-content: center;
  margin-bottom: 14px;
}

.brand-icon {
  width: 64px;
  height: 64px;
  border-radius: 22px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 86%, #ffffff) 0%,
    var(--ms-accent, var(--ms-accent)) 100%
  );
  color: var(--ms-on-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.7rem;
  box-shadow: 0 10px 22px color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 34%, transparent);
}

.step-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  color: var(--ms-text);
  text-align: center;
}

.step-subtitle {
  margin: 0 0 22px;
  font-size: 14px;
  color: var(--ms-muted);
  text-align: center;
  max-width: 280px;
  line-height: 1.4;
}

.field-label {
  align-self: flex-start;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ms-icon);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 7px;
}

.field-label.gap-top {
  margin-top: 12px;
}

/* Quasar-поле номера телефона — как прежнее большое поле входа */
.phone-input {
  width: 100%;
}

.phone-input :deep(.q-field__control) {
  min-height: 52px;
  border-radius: 14px;
  background: var(--ms-surface-2);
}

.phone-input :deep(.q-field__control:before) {
  border-color: var(--ms-border);
}

.phone-input :deep(.q-field__control:after) {
  border-color: var(--ms-accent, var(--ms-accent));
}

.phone-input :deep(.q-field__native) {
  padding: 0 16px;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--ms-text);
}

.phone-input :deep(input::placeholder) {
  color: var(--ms-muted-3);
  font-weight: 500;
  font-size: 15px;
}

.btn {
  width: 100%;
  margin-top: 14px;
  border: none;
  border-radius: 14px;
  padding: 13px 16px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition:
    transform 0.12s ease,
    box-shadow 0.2s ease,
    background 0.2s;
}

.btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
  transform: none !important;
}

.btn-primary {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 86%, #ffffff) 0%,
    var(--ms-accent, var(--ms-accent)) 100%
  );
  color: var(--ms-on-accent);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 30%, transparent);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 36%, transparent);
}

.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid color-mix(in srgb, var(--ms-on-accent) 45%, transparent);
  border-top-color: var(--ms-on-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* Индикатор силы пароля (подсказка; решает всё серверная политика). */
/* «Глазок» в полях пароля: иконка в append-слоте Quasar-инпута. */
.password-eye {
  cursor: pointer;
  color: var(--ms-muted-2);
}

.password-eye:hover {
  color: var(--ms-accent, var(--ms-accent));
}

.password-meter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 2px;
  font-size: 12.5px;
  color: var(--ms-muted);
}

.password-meter-bar {
  display: inline-block;
  width: 86px;
  height: 5px;
  border-radius: 999px;
  background: var(--ms-border);
  overflow: hidden;
}

.password-meter-bar > span {
  display: block;
  height: 100%;
  background: var(--ms-warn);
  transition: width 0.2s ease;
}

.password-meter[data-score='3'] .password-meter-bar > span {
  background: var(--ms-accent);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.privacy-hint {
  margin: 14px 0 0;
  font-size: 12.5px;
  color: var(--ms-muted-3);
  text-align: center;
}

.otp-form {
  width: 100%;
}

.link-btn {
  margin-top: 16px;
  background: none;
  border: none;
  color: var(--ms-icon);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
}

.link-btn:hover:not(:disabled) {
  background: var(--ms-surface-2);
  color: var(--ms-text);
}

.link-btn:disabled {
  opacity: 0.6;
}

.login-message {
  margin-top: 14px;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  text-align: center;
}

.login-message.msg-error {
  background: var(--ms-danger-bg);
  color: var(--ms-danger);
}

.login-message.msg-success {
  background: var(--ms-ok-bg);
  color: var(--ms-accent-strong);
}

.login-message.msg-info {
  background: var(--ms-info-bg);
  color: var(--ms-info);
}

.login-message.msg-warn {
  background: var(--ms-warn-bg);
  color: var(--ms-warn);
}

.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
