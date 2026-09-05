<script setup lang="ts">
import InputMask from 'primevue/inputmask'
import Message from 'primevue/message'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getErrorMessage } from '../services/errors'
import { ref, computed, onMounted, watch, nextTick } from 'vue'

const router = useRouter()
const authStore = useAuthStore()

const props = defineProps<{
  initialState?: 'phone' | 'otp'
}>()

const emit = defineEmits<{
  'state-changed': ['phone' | 'otp']
  'close-modal': []
}>()

const state = ref<'phone' | 'otp'>('phone')

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
const otpDigit1 = ref('')
const otpDigit2 = ref('')
const otpDigit3 = ref('')
const otpDigit4 = ref('')
const otpDigit5 = ref('')
const otpDigit6 = ref('')

const otpDigits = [otpDigit1, otpDigit2, otpDigit3, otpDigit4, otpDigit5, otpDigit6]

const otpCode = computed(() => otpDigits.map((digit) => digit.value).join(''))

const severity = ref<'success' | 'error' | 'info' | 'warn'>('success')
const result = ref('')
const isLoading = ref(false)

const isValidPhoneNumber = (phone: string): boolean => {
  const cleaned = phone.replace(/\D/g, '')
  return cleaned.startsWith('7') && cleaned.length === 11
}

const formatPhoneForBackend = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '')
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`
}

/** Красивый формат номера для показа на экране ввода кода. */
const prettyPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '').replace(/^7/, '')
  if (digits.length < 10) return phone || '+7'
  const d = digits.slice(0, 10)
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`
}

async function requestOtpHandler() {
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
    await authStore.requestOtp(formatPhoneForBackend(phoneOrUsername.value))
    state.value = 'otp'
    emit('state-changed', state.value)
  } catch (error: unknown) {
    console.error('Request OTP failed:', error)
    result.value = getErrorMessage(error, 'Не удалось отправить код OTP.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

async function onFormSubmit() {
  if (authStore.isAuthenticated) {
    emit('close-modal')
    return
  }

  const fullOtpCode = otpCode.value
  if (fullOtpCode.length !== 6 || isNaN(Number(fullOtpCode))) {
    result.value = 'Код OTP должен состоять из 6 цифр.'
    severity.value = 'error'
    return
  }

  isLoading.value = true
  result.value = ''
  try {
    await authStore.loginWithOtp(formatPhoneForBackend(phoneOrUsername.value), fullOtpCode, router)
    state.value = 'phone'
    otpDigits.forEach((digit) => (digit.value = ''))
    phoneOrUsername.value = ''
    result.value = ''
    emit('close-modal')
  } catch (error: unknown) {
    console.error('Login with OTP failed:', error)
    result.value = getErrorMessage(error, 'Вход не удался.')
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

function goBackToPhoneInput() {
  state.value = 'phone'
  emit('state-changed', state.value)
  otpDigits.forEach((digit) => (digit.value = ''))
  result.value = ''
}

const moveFocus = (currentIndex: number, event: Event) => {
  const target = event.target as HTMLInputElement

  if (target.value && currentIndex < 5) {
    otpDigits[currentIndex + 1].value = ''
    const nextInput = document.getElementById(`otp-digit-${currentIndex + 2}`)
    if (nextInput) {
      nextInput.focus()
    }
  }

  if (
    event instanceof KeyboardEvent &&
    event.key === 'Backspace' &&
    !target.value &&
    currentIndex > 0
  ) {
    const prevInput = document.getElementById(`otp-digit-${currentIndex}`)
    if (prevInput) {
      prevInput.focus()
    }
  }
}

/** Фокусируем первое поле OTP при переходе на шаг ввода кода. */
const focusFirstOtp = () => {
  const first = document.getElementById('otp-digit-1')
  if (first) {
    first.focus()
  }
}

watch(state, (value) => {
  if (value === 'otp') {
    nextTick(focusFirstOtp)
  }
})

onMounted(() => {
  if (state.value === 'otp') {
    focusFirstOtp()
  }
})
</script>

<template>
  <div class="login-modal">
    <transition name="fade" mode="out-in">
      <!-- Шаг 1: номер телефона -->
      <div v-if="state === 'phone'" key="phone" class="step">
        <div class="brand">
          <span class="brand-icon"><i class="pi pi-phone"></i></span>
        </div>
        <h2 class="step-title">Вход по номеру телефона</h2>
        <p class="step-subtitle">Мы отправим SMS с кодом подтверждения.</p>

        <label class="field-label" for="phone-input">Номер телефона</label>
        <div class="input-shell">
          <InputMask
            id="phone-input"
            v-model="phoneOrUsername"
            mask="+7 (999) 999-99-99"
            placeholder="+7 (___) ___-__-__"
            class="phone-input"
            :auto-clear="false"
          />
        </div>

        <button class="btn btn-primary" :disabled="isLoading" @click="requestOtpHandler">
          <span v-if="isLoading" class="spinner"></span>
          <template v-else><i class="pi pi-send"></i></template>
          <span>{{ isLoading ? 'Отправка…' : 'Получить код' }}</span>
        </button>

        <p class="privacy-hint">Код придёт в SMS. Никому его не сообщайте.</p>
      </div>

      <!-- Шаг 2: код из SMS -->
      <div v-else key="otp" class="step">
        <div class="brand">
          <span class="brand-icon"><i class="pi pi-shield"></i></span>
        </div>
        <h2 class="step-title">Введите код из SMS</h2>
        <p class="step-subtitle">
          Мы отправили код на номер
          <strong>{{ prettyPhone(phoneOrUsername) }}</strong>
        </p>

        <form class="otp-form" @submit.prevent="onFormSubmit">
          <div class="otp-grid">
            <input
              v-for="(digitRef, index) in otpDigits"
              :id="`otp-digit-${index + 1}`"
              :key="index"
              v-model="digitRef.value"
              type="text"
              maxlength="1"
              inputmode="numeric"
              pattern="[0-9]"
              autocomplete="one-time-code"
              class="otp-box"
              :class="{ filled: digitRef.value }"
              @input="(e) => moveFocus(index, e)"
              @keydown.backspace="(e) => moveFocus(index, e)"
              @paste.prevent
            />
          </div>

          <button type="submit" class="btn btn-primary" :disabled="isLoading || otpCode.length < 6">
            <span v-if="isLoading" class="spinner"></span>
            <template v-else><i class="pi pi-check"></i></template>
            <span>{{ isLoading ? 'Вход…' : 'Войти' }}</span>
          </button>
        </form>

        <button class="link-btn" type="button" :disabled="isLoading" @click="goBackToPhoneInput">
          <i class="pi pi-arrow-left"></i>
          Изменить номер
        </button>
      </div>
    </transition>

    <transition name="fade">
      <Message
        v-if="result && result !== 'Код OTP отправлен!' && result !== 'Вход успешен!'"
        :severity="severity"
        size="small"
        variant="simple"
        class="login-message"
      >
        {{ result }}
      </Message>
    </transition>
  </div>
</template>

<style scoped>
.login-modal {
  width: 100%;
  padding: 8px 4px;
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
  background: linear-gradient(135deg, #34c979 0%, #1e9b51 100%);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.7rem;
  box-shadow: 0 10px 22px rgba(30, 155, 81, 0.35);
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

.input-shell {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  border: 1.5px solid #dfe5ea;
  border-radius: 14px;
  background: #f7f9fb;
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    background 0.2s;
}

.input-shell:focus-within {
  border-color: #2ea25e;
  background: #fff;
  box-shadow: 0 0 0 4px rgba(46, 162, 94, 0.14);
}

.phone-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: #1c2733;
  padding: 14px 16px;
  width: 100%;
  min-width: 0;
  text-align: center;
}

.phone-input::placeholder {
  color: #a9b5bf;
  font-weight: 500;
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
  background: linear-gradient(135deg, #34c979 0%, #1e9b51 100%);
  color: #fff;
  box-shadow: 0 8px 18px rgba(30, 155, 81, 0.28);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px rgba(30, 155, 81, 0.34);
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
  border-color: #2ea25e;
  background: #eef9f1;
}

.otp-box:focus {
  border-color: #2ea25e;
  box-shadow: 0 0 0 4px rgba(46, 162, 94, 0.16);
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
