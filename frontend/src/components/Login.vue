<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getErrorMessage } from '../services/errors'
import { ref, computed, onMounted, nextTick } from 'vue'
import { formatPhoneForBackend, isValidPhoneNumber, prettyPhone } from '@/utils/phone'

type LoginState = 'phone' | 'password' | 'create'

const router = useRouter()
const authStore = useAuthStore()

const props = defineProps<{
  initialState?: LoginState
}>()

const emit = defineEmits<{
  'state-changed': [LoginState]
  'close-modal': []
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
})

const phoneOrUsername = ref('')
const password = ref('')
const passwordConfirm = ref('')
const passwordFieldRef = ref<HTMLInputElement | null>(null)
/** Есть ли у номера уже заданный пароль (иначе — предлагаем создать). */
const hasPassword = ref(false)
/** Аккаунта ещё не существует (новый номер). */
const isNewNumber = ref(false)

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
    password.value = ''
    passwordConfirm.value = ''
    state.value = status.has_password ? 'password' : 'create'
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

function resetPasswordFields() {
  password.value = ''
  passwordConfirm.value = ''
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
    console.error('Login failed:', error)
    result.value = getErrorMessage(error, 'Неверный номер или пароль.')
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

  if (password.value.length < 6) {
    result.value = 'Пароль должен быть не короче 6 символов.'
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
    await authStore.registerWithPassword(
      formatPhoneForBackend(phoneOrUsername.value),
      password.value,
      router
    )
    resetPasswordFields()
    phoneOrUsername.value = ''
    result.value = ''
    emit('close-modal')
  } catch (error: unknown) {
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
  result.value = ''
}
</script>

<template>
  <div class="login-modal">
    <transition name="fade" mode="out-in">
      <!-- Шаг 1: номер телефона -->
      <div v-if="state === 'phone'" key="phone" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon name="call" size="30px" /></span>
        </div>
        <h2 class="step-title">Вход</h2>
        <p class="step-subtitle">Введите номер телефона — войдёте по паролю.</p>

        <label class="field-label" for="phone-input">Номер телефона</label>
        <q-input
          id="phone-input"
          v-model="phoneOrUsername"
          mask="+7 (###) ###-##-##"
          outlined
          class="phone-input"
          placeholder="+7 (___) ___-__-__"
          aria-label="Номер телефона"
          hide-bottom-space
          @keyup.enter="continueWithPhone"
        />

        <button class="btn btn-primary" :disabled="isLoading" @click="continueWithPhone">
          <span v-if="isLoading" class="spinner"></span>
          <q-icon v-else name="arrow_forward" size="17px" />
          <span>{{ isLoading ? 'Проверка…' : 'Продолжить' }}</span>
        </button>

        <p class="privacy-hint">Если пароля ещё нет — предложим его создать.</p>
      </div>

      <!-- Шаг 2а: ввод пароля (номер уже зарегистрирован) -->
      <div v-else-if="state === 'password'" key="password" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon name="lock" size="30px" /></span>
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
            id="password-input"
            ref="passwordFieldRef"
            v-model="password"
            type="password"
            outlined
            class="phone-input"
            placeholder="Введите пароль"
            autocomplete="current-password"
            aria-label="Пароль"
            hide-bottom-space
          />

          <button type="submit" class="btn btn-primary" :disabled="isLoading">
            <span v-if="isLoading" class="spinner"></span>
            <q-icon v-else name="check" size="17px" />
            <span>{{ isLoading ? 'Вход…' : 'Войти' }}</span>
          </button>
        </form>

        <button class="link-btn" type="button" :disabled="isLoading" @click="goBackToPhoneInput">
          <q-icon name="arrow_back" size="17px" />
          Изменить номер
        </button>
      </div>

      <!-- Шаг 2б: создание пароля (новый номер или пароль ещё не задан) -->
      <div v-else key="create" class="step">
        <div class="brand">
          <span class="brand-icon"><q-icon name="person_add" size="30px" /></span>
        </div>
        <h2 class="step-title">{{ isNewNumber ? 'Создание аккаунта' : 'Придумайте пароль' }}</h2>
        <p class="step-subtitle">
          {{
            isNewNumber
              ? `Номер ${prettyPhone(phoneOrUsername)} ещё не зарегистрирован — придумайте пароль.`
              : `Для номера ${prettyPhone(phoneOrUsername)} ещё нет пароля — задайте его.`
          }}
        </p>

        <form class="otp-form" @submit.prevent="onCreateSubmit">
          <label class="field-label" for="new-password-input">Пароль</label>
          <q-input
            id="new-password-input"
            ref="passwordFieldRef"
            v-model="password"
            type="password"
            outlined
            class="phone-input"
            placeholder="Не короче 6 символов"
            autocomplete="new-password"
            aria-label="Новый пароль"
            hide-bottom-space
            @keyup.enter="onCreateSubmit"
          />

          <label class="field-label gap-top" for="confirm-password-input">Повторите пароль</label>
          <q-input
            id="confirm-password-input"
            v-model="passwordConfirm"
            type="password"
            outlined
            class="phone-input"
            placeholder="Повторите пароль"
            autocomplete="new-password"
            aria-label="Повтор пароля"
            hide-bottom-space
            @keyup.enter="onCreateSubmit"
          />

          <button type="submit" class="btn btn-primary" :disabled="isLoading">
            <span v-if="isLoading" class="spinner"></span>
            <q-icon v-else name="check" size="17px" />
            <span>{{ isLoading ? 'Создание…' : 'Создать пароль и войти' }}</span>
          </button>
        </form>

        <button class="link-btn" type="button" :disabled="isLoading" @click="goBackToPhoneInput">
          <q-icon name="arrow_back" size="17px" />
          Изменить номер
        </button>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="showNotice" class="login-message" :class="'msg-' + severity" role="alert">
        {{ result }}
      </div>
    </transition>

    <!-- Уведомление об обработке персональных данных (требование RuStore и 152-ФЗ). -->
    <p class="privacy-note">
      Продолжая, вы соглашаетесь с
      <a href="/privacy.html" target="_blank" rel="noopener">политикой конфиденциальности</a>
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
  color: #7d8894;
}

.privacy-note a {
  color: var(--ms-accent, #2ea25e);
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
    color-mix(in srgb, var(--ms-accent, #2ea25e) 86%, #ffffff) 0%,
    var(--ms-accent, #2ea25e) 100%
  );
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.7rem;
  box-shadow: 0 10px 22px color-mix(in srgb, var(--ms-accent, #2ea25e) 34%, transparent);
}

.step-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  color: #1c2733;
  text-align: center;
}

.step-subtitle {
  margin: 0 0 22px;
  font-size: 14px;
  color: #71808d;
  text-align: center;
  max-width: 280px;
  line-height: 1.4;
}

.field-label {
  align-self: flex-start;
  font-size: 12.5px;
  font-weight: 600;
  color: #52626f;
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
  background: #f7f9fb;
}

.phone-input :deep(.q-field__control:before) {
  border-color: #dfe5ea;
}

.phone-input :deep(.q-field__control:after) {
  border-color: var(--ms-accent, #2ea25e);
}

.phone-input :deep(.q-field__native) {
  padding: 0 16px;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: #1c2733;
}

.phone-input :deep(input::placeholder) {
  color: #a9b5bf;
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
    color-mix(in srgb, var(--ms-accent, #2ea25e) 86%, #ffffff) 0%,
    var(--ms-accent, #2ea25e) 100%
  );
  color: #fff;
  box-shadow: 0 8px 18px color-mix(in srgb, var(--ms-accent, #2ea25e) 30%, transparent);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px color-mix(in srgb, var(--ms-accent, #2ea25e) 36%, transparent);
}

.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.privacy-hint {
  margin: 14px 0 0;
  font-size: 12.5px;
  color: #93a0ab;
  text-align: center;
}

.otp-form {
  width: 100%;
}

.otp-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
  margin-bottom: 2px;
}

.otp-box {
  width: 100%;
  aspect-ratio: 1;
  text-align: center;
  font-size: 20px;
  font-weight: 700;
  color: #1c2733;
  background: #f7f9fb;
  border: 1.5px solid #dfe5ea;
  border-radius: 12px;
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s,
    background 0.15s,
    transform 0.1s;
}

.otp-box.filled {
  border-color: var(--ms-accent, #2ea25e);
  background: color-mix(in srgb, var(--ms-accent, #2ea25e) 12%, #ffffff);
}

.otp-box:focus {
  border-color: var(--ms-accent, #2ea25e);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ms-accent, #2ea25e) 16%, transparent);
  transform: scale(1.05);
  background: #fff;
}

.link-btn {
  margin-top: 16px;
  background: none;
  border: none;
  color: #52626f;
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
  background: #f1f3f5;
  color: #1c2733;
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
  background: #fdecec;
  color: #c0392b;
}

.login-message.msg-success {
  background: #e8f8ee;
  color: #1e7a43;
}

.login-message.msg-info {
  background: #e8f2fb;
  color: #2f6da0;
}

.login-message.msg-warn {
  background: #fdf3e3;
  color: #9a6a14;
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
