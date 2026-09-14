<script setup lang="ts">
import { icon } from '@/utils/icons'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { getErrorMessage } from '@/services/errors'
import { formatPhoneForBackend, isValidPhoneNumber } from '@/utils/phone'
import { PASSWORD_MIN_LENGTH, passwordProblem } from '@/utils/passwordPolicy'

// Регистрация по персональной ссылке-приглашению (/invite/:token). Публичной
// регистрации нет — попасть сюда можно только по ссылке, которую владелец
// сервиса выдал лично (см. backend/scripts/create_invite.py).
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const token = String(route.params.token ?? '')

/** null — ещё проверяем, true/false — результат проверки ссылки. */
const inviteValid = ref<boolean | null>(null)
/** Номер закреплён за приглашением — поле нередактируемое. */
const lockedPhone = ref<string | null>(null)

const phone = ref('')
const password = ref('')
const passwordConfirm = ref('')
const busy = ref(false)
const errorMessage = ref('')

onMounted(async () => {
  if (authStore.isAuthenticated) {
    await router.replace({ name: 'Messenger' })
    return
  }
  try {
    const status = await authStore.fetchInviteStatus(token)
    inviteValid.value = status.valid
    if (status.phone_number) {
      lockedPhone.value = status.phone_number
      phone.value = status.phone_number
    }
  } catch {
    inviteValid.value = false
  }
})

const submit = async () => {
  errorMessage.value = ''

  const formattedPhone = formatPhoneForBackend(phone.value)
  if (!isValidPhoneNumber(formattedPhone)) {
    errorMessage.value = 'Введите корректный номер телефона.'
    return
  }
  const problem = passwordProblem(password.value, { phoneNumber: formattedPhone })
  if (problem) {
    errorMessage.value = problem
    return
  }
  if (password.value !== passwordConfirm.value) {
    errorMessage.value = 'Пароли не совпадают.'
    return
  }

  busy.value = true
  try {
    await authStore.registerWithInvite(token, formattedPhone, password.value, router)
  } catch (error) {
    errorMessage.value = getErrorMessage(error, 'Не удалось завершить регистрацию.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-modal">
    <div class="step">
      <div class="brand">
        <span class="brand-icon"><q-icon :name="icon('mail')" size="30px" /></span>
      </div>

      <template v-if="inviteValid === null">
        <p class="step-subtitle">Проверяем ссылку-приглашение…</p>
      </template>

      <template v-else-if="inviteValid === false">
        <h2 class="step-title">Ссылка недействительна</h2>
        <p class="step-subtitle">
          Эта ссылка-приглашение уже использована, истекла или не существует. Обратитесь к тому,
          кто её отправил, за новой ссылкой.
        </p>
        <button class="link-btn" type="button" @click="router.push({ name: 'Login' })">
          На страницу входа
        </button>
      </template>

      <template v-else>
        <h2 class="step-title">Регистрация по приглашению</h2>
        <p class="step-subtitle">
          Придумайте пароль, чтобы завершить создание аккаунта.
        </p>

        <form class="otp-form" @submit.prevent="submit">
          <label class="field-label" for="invite-phone">Номер телефона</label>
          <q-input
            id="invite-phone"
            v-model="phone"
            outlined
            class="phone-input"
            placeholder="+7 999 123-45-67"
            autocomplete="tel"
            inputmode="tel"
            :disable="!!lockedPhone"
            hide-bottom-space
          />

          <label class="field-label gap-top" for="invite-password">Пароль</label>
          <q-input
            id="invite-password"
            v-model="password"
            type="password"
            outlined
            class="phone-input"
            :placeholder="`Минимум ${PASSWORD_MIN_LENGTH} символов`"
            autocomplete="new-password"
            hide-bottom-space
          />

          <label class="field-label gap-top" for="invite-password-confirm">Повторите пароль</label>
          <q-input
            id="invite-password-confirm"
            v-model="passwordConfirm"
            type="password"
            outlined
            class="phone-input"
            autocomplete="new-password"
            hide-bottom-space
          />

          <q-btn
            unelevated
            no-caps
            color="primary"
            type="submit"
            class="submit-btn full"
            :loading="busy"
            :disable="busy"
          >
            Создать аккаунт
          </q-btn>
        </form>
      </template>

      <transition name="fade">
        <div v-if="errorMessage" class="login-message msg-error" role="alert">
          {{ errorMessage }}
        </div>
      </transition>
    </div>

    <p class="privacy-note">
      Продолжая, вы соглашаетесь с
      <a href="/privacy.html" target="_blank" rel="noopener">политикой конфиденциальности</a>,
      <a href="/terms.html" target="_blank" rel="noopener">пользовательским соглашением</a>,
      <a href="/community.html" target="_blank" rel="noopener">правилами сообщества</a>
      и обработкой персональных данных.
    </p>
  </div>
</template>

<style scoped>
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
  max-width: 320px;
  line-height: 1.4;
}

.otp-form {
  display: flex;
  flex-direction: column;
  width: 100%;
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

.submit-btn.full {
  width: 100%;
  margin-top: 18px;
  border-radius: 14px;
  min-height: 48px;
  font-size: 15px;
  font-weight: 700;
}

.link-btn {
  margin-top: 16px;
  background: none;
  border: none;
  color: var(--ms-accent, var(--ms-accent));
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.login-message {
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13.5px;
  text-align: center;
  width: 100%;
  box-sizing: border-box;
}

.login-message.msg-error {
  background: var(--ms-danger-bg);
  color: var(--ms-danger);
}

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

.fade-enter-active,
.fade-leave-active {
  transition: all 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
