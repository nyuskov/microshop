<template>
  <q-dialog v-model="shouldShowModal" persistent @hide="onDialogHide">
    <q-card class="login-dialog-card">
      <Login
        @close-modal="handleLoginClose"
        :initial-state="state"
        @state-changed="handleStateChanged"
        @otp-verified="onOtpVerified"
      />
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Login from './Login.vue'
import { useAuthStore } from '../stores/auth'

const props = defineProps<{
  visible: boolean
  initialState?: 'phone' | 'password' | 'otp' | 'create' | 'email'
}>()

const emit = defineEmits<{
  'close-modal': []
}>()

const authStore = useAuthStore()

/**
 * Код подтверждён, но пароль ещё не задан. В этот момент пользователь уже
 * аутентифицирован, но модалку закрывать рано — иначе он не увидит шаг
 * «придумайте пароль» и останется без пароля.
 */
const pendingPassword = ref(false)

// Вычисляемое свойство, которое учитывает статус аутентификации
const shouldShowModal = computed({
  get: () => {
    // Не показываем модалку, если пользователь уже аутентифицирован
    // (кроме случая, когда он в середине сценария "код → пароль")
    if (authStore.isAuthenticated && !pendingPassword.value) {
      return false
    }
    return props.visible
  },
  set: (value) => {
    // Если пытаются закрыть модалку, но пользователь не аутентифицирован
    if (!value && !authStore.isAuthenticated) {
      emit('close-modal')
    }
  }
})

const state = ref<'phone' | 'password' | 'otp' | 'create' | 'email'>(props.initialState || 'phone')

// Синхронизация состояния с пропсом
watch(
  () => props.visible,
  (newVal) => {
    // Не открываем модалку, если пользователь уже аутентифицирован
    if (authStore.isAuthenticated) {
      emit('close-modal')
      return
    }
    // Если модалка должна открыться, но пользователь не аутентифицирован
    if (newVal && !authStore.isAuthenticated) {
      // Можно добавить логику при открытии
      state.value = props.initialState || 'phone'
    }
  },
  { immediate: true }
)

// Обработка закрытия диалога
const handleLoginClose = () => {
  console.log("Login component emitted 'close-modal' inside LoginModal. Emitting to parent.")
  pendingPassword.value = false
  emit('close-modal')
}

/** Закрытие по Esc/бэкдропу — тоже «закрыть» (но persistent не даёт). */
const onDialogHide = () => {
  if (!authStore.isAuthenticated) {
    emit('close-modal')
  }
}

// Обработка события от Login.vue, когда состояние меняется (phone -> password/otp/create)
const handleStateChanged = (newState: 'phone' | 'password' | 'otp' | 'create' | 'email') => {
  state.value = newState
}

/** Код подтверждён: держим модалку, пока пользователь не задаст пароль. */
const onOtpVerified = () => {
  pendingPassword.value = true
}
</script>

<style scoped>
/* Форма входа — самодостаточная светлая карточка (тёмный текст), поэтому
   всегда белая, независимо от темы мессенджера вокруг. */
.login-dialog-card {
  width: min(420px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  border-radius: 20px;
  background: #ffffff !important;
  color: #1c2733 !important;
  border: 1px solid #e2e6ea;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.32);
}
</style>
