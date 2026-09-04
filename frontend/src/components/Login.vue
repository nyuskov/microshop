<script setup lang="ts">
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
// Импортирую InputMask
import InputMask from 'primevue/inputmask'
import Message from 'primevue/message'
// Удаляю zod и zodResolver
// import { zodResolver } from '@primevue/forms/resolvers/zod'
// import { z } from 'zod'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth' // Импортируем store
import { ref, computed } from 'vue' // Добавляю computed

const router = useRouter()
const authStore = useAuthStore() // Инициализируем store

// Состояние компонента: 'phone' - ввод телефона, 'otp' - ввод кода
const state = ref<'phone' | 'otp'>('phone')
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
const isLoading = ref(false) // Состояние загрузки для кнопок

// Функция для проверки валидности номера телефона (формат +7 (...) ...)
const isValidPhoneNumber = (phone: string): boolean => {
  // Удаляем все символы, кроме цифр
  const cleaned = phone.replace(/\D/g, '')
  // Проверяем, начинается ли с '7' и состоит ли из 11 цифр
  return cleaned.startsWith('7') && cleaned.length === 11
}

// Функция для преобразования строки в формате +7 (...) ... в формат, пригодный для отправки
const formatPhoneForBackend = (phone: string): string => {
  // Удаляем все символы, кроме цифр
  const cleaned = phone.replace(/\D/g, '')
  // Вставляем '+' в начало, если его нет
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`
}

// Функция для запроса OTP
async function requestOtpHandler() {
  // Валидация номера телефона
  if (!isValidPhoneNumber(phoneOrUsername.value)) {
    result.value = 'Введите корректный номер телефона в формате +7 (___) ___-__-__'
    severity.value = 'error'
    return
  }

  isLoading.value = true
  result.value = ''
  try {
    // Отправляем отформатированный номер
    await authStore.requestOtp(formatPhoneForBackend(phoneOrUsername.value))
    // Убираю сообщение об отправке
    // result.value = 'Код OTP отправлен!';
    // severity.value = 'success';
    state.value = 'otp' // Переходим к вводу OTP
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
    // Вызываем loginWithOtp из store
    await authStore.loginWithOtp(formatPhoneForBackend(phoneOrUsername.value), fullOtpCode, router)
    // Убираю сообщение об успешном входе
    // result.value = 'Вход успешен!';
    // severity.value = 'success';
    // Перенаправление теперь происходит внутри loginWithOtp после успешного входа
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
    isLoading.value = false
  }
}

// Вспомогательная функция для возврата к вводу телефона
function goBackToPhoneInput() {
  state.value = 'phone'
  // Очищаем все 6 полей OTP
  otpDigits.forEach((digit) => (digit.value = ''))
  result.value = ''
}

// Функция для перемещения фокуса между полями OTP
const moveFocus = (currentIndex: number, event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.value && currentIndex < 5) {
    otpDigits[currentIndex + 1].value = ''
    // Использую nextTick для гарантии обновления DOM перед фокусировкой
    // Но в данном случае, так как значение следующего поля устанавливается выше,
    // и оно пустое, фокус может сразу не сработать как ожидалось.
    // Лучше вызвать focus напрямую на элементе.
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
      // Опционально: можно очистить предыдущее поле при переходе назад
      // otpDigits[currentIndex - 1].value = '';
    }
  }
}
</script>

<template>
  <div class="cnt-login">
    <!-- Форма для ввода телефона -->
    <div v-if="state === 'phone'" class="phone-input-section">
      <h3>Вход по SMS</h3>
      <!-- Убираю Form и FormField для ввода телефона, так как использую валидацию вручную -->
      <div class="frm-login flex flex-col gap-4 w-full sm:w-80">
        <div class="flex txt-login flex-col gap-1">
          <!-- Не очищать поле, если введенное значение не соответствует маске -->
          <!-- Перенес комментарий -->
          <InputMask
            v-model="phoneOrUsername"
            mask="+7 (999) 999-99-99"
            placeholder="+7 (___) ___-__-__"
            class="txt-login"
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
      <h3>Введите код из SMS</h3>
      <!-- Использую простую форму для обработки Enter -->
      <form @submit.prevent="onFormSubmit" class="frm-login flex flex-col gap-4 w-full sm:w-80">
        <div class="flex txt-login flex-col gap-1">
          <!-- Поле для ввода OTP -->
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
/* Можно добавить специфичные стили для новых секций при желании */
.phone-input-section,
.otp-input-section {
  transition: opacity 0.3s ease;
}

.otp-input-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.otp-digit-input {
  width: calc((100vw - 4rem - 5 * 0.5rem) / 6); /* Ширина с учетом gap и padding контейнера */
  max-width: 3rem; /* Максимальная ширина для больших экранов */
  height: 3rem;
  text-align: center;
  font-size: 1.2rem;
  border: 2px solid var(--p-inputbordercolor);
  border-radius: 8px;
  transition: border-color 0.2s;
}

.otp-digit-input.has-value {
  border-color: var(--p-primarycolor);
  background-color: var(--p-fieldbgcolor);
}

.otp-digit-input:focus {
  outline: 0 none;
  border-color: var(--p-primarycolor);
  box-shadow: 0 0 0 0.2rem var(--p-focusringcolor);
}

@media (min-width: 640px) {
  .otp-digit-input {
    width: calc(
      (min(100vw, 24rem) - 4rem - 5 * 0.5rem) / 6
    ); /* Более адаптивная ширина для desktop */
  }
}
</style>
