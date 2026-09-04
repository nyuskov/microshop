<script setup lang="ts">
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputMask from 'primevue/inputmask'
import Message from 'primevue/message'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { ref, computed, onMounted } from 'vue'

const router = useRouter()
const authStore = useAuthStore()

// Пропс для получения начального состояния
const props = defineProps<{
  initialState?: 'phone' | 'otp'
}>()

// Эмиты для уведомления родителя о смене состояния и о закрытии
const emit = defineEmits<{
  'state-changed': ['phone' | 'otp']
  'close-modal': []
}>()

// Состояние компонента: 'phone' - ввод телефона, 'otp' - ввод кода
const state = ref<'phone' | 'otp'>('phone')

// Устанавливаем начальное состояние из пропсов
onMounted(() => {
  // Проверяем, не аутентифицирован ли пользователь уже
  if (authStore.isAuthenticated) {
    emit('close-modal')
    return
  }

  if (props.initialState) {
    state.value = props.initialState
    emit('state-changed', state.value)
  }
})

// Теперь phoneOrUsername будет строкой в формате +7 (...)
const phoneOrUsername = ref('')
// Разделю OTP на 6 переменных
const otpDigit1 = ref('')
const otpDigit2 = ref('')
const otpDigit3 = ref('')
const otpDigit4 = ref('')
const otpDigit5 = ref('')
const otpDigit6 = ref('')

// Массив для удобного доступа к ref'ам
const otpDigits = [otpDigit1, otpDigit2, otpDigit3, otpDigit4, otpDigit5, otpDigit6]

// Вычисляемое свойство для объединенного кода OTP
const otpCode = computed(() => {
  return otpDigits.map((digit) => digit.value).join('')
})

const severity = ref('success')
const result = ref('')
const isLoading = ref(false)

// Функция для проверки валидности номера телефона (формат +7 (...) ...)
const isValidPhoneNumber = (phone: string): boolean => {
  const cleaned = phone.replace(/\D/g, '')
  return cleaned.startsWith('7') && cleaned.length === 11
}

// Функция для преобразования строки в формате +7 (...) ... в формат, пригодный для отправки
const formatPhoneForBackend = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '')
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`
}

// Функция для запроса OTP
async function requestOtpHandler() {
  // Проверяем, не аутентифицирован ли пользователь
  if (authStore.isAuthenticated) {
    emit('close-modal')
    return
  }

  // Валидация номера телефона
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
    let errorMessage = 'Не удалось отправить код OTP.'
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      error.response.data &&
      error.response.data.detail
    ) {
      errorMessage = error.response.data.detail
    } else if (error && typeof error === 'object' && 'message' in error && error.message) {
      errorMessage = error.message
    }
    result.value = errorMessage
    severity.value = 'error'
  } finally {
    isLoading.value = false
  }
}

// Функция для обработки формы (отправка OTP для верификации)
async function onFormSubmit() {
  console.log('onFormSubmit started')

  // Проверяем, не аутентифицирован ли пользователь
  if (authStore.isAuthenticated) {
    emit('close-modal')
    return
  }

  // Валидация OTP: проверяем, что все 6 полей заполнены цифрами
  const fullOtpCode = otpCode.value
  if (fullOtpCode.length !== 6 || isNaN(Number(fullOtpCode))) {
    result.value = 'Код OTP должен состоять из 6 цифр.'
    severity.value = 'error'
    return
  }

  isLoading.value = true
  result.value = ''

  try {
    console.log('Calling authStore.loginWithOtp...')
    await authStore.loginWithOtp(formatPhoneForBackend(phoneOrUsername.value), fullOtpCode, router)
    console.log('authStore.loginWithOtp completed successfully.')

    // Успешная аутентификация - закрываем модалку
    console.log("Authentication confirmed. Emitting 'close-modal' event.")

    // Сбрасываем состояние перед закрытием
    state.value = 'phone'
    otpDigits.forEach((digit) => (digit.value = ''))
    phoneOrUsername.value = ''
    result.value = ''

    // Закрываем модалку
    emit('close-modal')
  } catch (error: unknown) {
    console.error('Login with OTP failed:', error)
    let errorMessage = 'Вход не удался.'
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      error.response.data &&
      error.response.data.detail
    ) {
      errorMessage = error.response.data.detail
    } else if (error && typeof error === 'object' && 'message' in error && error.message) {
      errorMessage = error.message
    }
    result.value = errorMessage
    severity.value = 'error'
  } finally {
    console.log('onFormSubmit finally block executed.')
    isLoading.value = false
  }
}

// Вспомогательная функция для возврата к вводу телефона
function goBackToPhoneInput() {
  state.value = 'phone'
  emit('state-changed', state.value)
  otpDigits.forEach((digit) => (digit.value = ''))
  result.value = ''
}

// Функция для перемещения фокуса между полями OTP
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
</script>

<template>
  <div class="cnt-login-modal-content">
    <!-- Форма для ввода телефона -->
    <div v-if="state === 'phone'" class="phone-input-section">
      <div class="frm-login flex flex-col gap-4 w-full sm:w-80">
        <div class="flex txt-login flex-col gap-1">
          <InputMask
            v-model="phoneOrUsername"
            mask="+7 (999) 999-99-99"
            placeholder="+7 (___) ___-__-__"
            class="single-phone-input"
            :auto-clear="false"
          />
        </div>
        <Button
          @click="requestOtpHandler"
          label="Получить SMS с кодом"
          class="btn-login"
          severity="secondary"
          :loading="isLoading"
          :disabled="isLoading"
        ></Button>
      </div>
    </div>

    <!-- Форма для ввода OTP -->
    <div v-if="state === 'otp'" class="otp-input-section">
      <form @submit.prevent="onFormSubmit" class="frm-login flex flex-col gap-4 w-full sm:w-80">
        <div class="flex txt-login flex-col gap-1">
          <div class="otp-input-grid">
            <InputText
              v-for="(digitRef, index) in otpDigits"
              :id="`otp-digit-${index + 1}`"
              :key="index"
              v-model="digitRef.value"
              type="text"
              maxlength="1"
              inputmode="numeric"
              pattern="[0-9]"
              class="otp-digit-input"
              :class="{ 'has-value': digitRef.value }"
              @input="(e) => moveFocus(index, e)"
              @keydown.backspace="(e) => moveFocus(index, e)"
              @paste.prevent
            />
          </div>
        </div>
        <Button
          type="submit"
          label="Войти"
          class="btn-login"
          severity="secondary"
          :loading="isLoading"
          :disabled="isLoading || otpCode.length < 6"
        ></Button>
        <Button
          @click="goBackToPhoneInput"
          label="Изменить номер"
          class="btn-login"
          severity="help"
          text
        ></Button>
      </form>
    </div>

    <!-- Сообщение об ошибке -->
    <Message
      v-if="result && result !== 'Код OTP отправлен!' && result !== 'Вход успешен!'"
      :severity="severity"
      size="small"
      variant="simple"
    >
      {{ result }}
    </Message>
  </div>
</template>

<style src="../assets/css/style.css" scoped></style>
<style scoped>
/* Стили для контента модального окна */
.cnt-login-modal-content {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
}

.phone-input-section,
.otp-input-section {
  width: 100%;
  transition: opacity 0.3s ease;
}

.otp-input-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.single-phone-input {
  width: 100%;
  height: 3rem;
  text-align: center;
  font-size: 1.2rem;
  border: 2px solid var(--p-inputbordercolor);
  border-radius: 8px;
  transition:
    border-color 0.2s,
    transform 0.2s,
    box-shadow 0.2s;
  background-color: var(--p-surface-card);
  color: var(--p-textcolor);
  padding: 0 0.5rem;
}

.single-phone-input:hover {
  transform: scale(1.02);
  border-color: var(--p-primary-300);
}

.single-phone-input:focus {
  outline: 0 none;
  border-color: var(--p-primary-500);
  box-shadow: 0 0 0 0.2rem var(--p-primary-200);
  transform: scale(1.02);
}

.otp-digit-input {
  width: calc((100vw - 4rem - 5 * 0.5rem) / 6);
  max-width: 3rem;
  height: 3rem;
  text-align: center;
  font-size: 1.2rem;
  border: 2px solid var(--p-inputbordercolor);
  border-radius: 8px;
  transition:
    border-color 0.2s,
    transform 0.2s,
    box-shadow 0.2s;
  background-color: var(--p-surface-card);
  color: var(--p-textcolor);
}

.otp-digit-input:hover {
  transform: scale(1.05);
  border-color: var(--p-primary-300);
}

.otp-digit-input.has-value {
  border-color: var(--p-primarycolor);
  background-color: var(--p-primary-50);
  color: var(--p-primary-700);
}

.otp-digit-input:focus {
  outline: 0 none;
  border-color: var(--p-primary-500);
  box-shadow: 0 0 0 0.2rem var(--p-primary-200);
  transform: scale(1.05);
}

@media (min-width: 640px) {
  .otp-digit-input {
    width: calc((min(100vw, 24rem) - 4rem - 5 * 0.5rem) / 6);
  }
}
</style>
