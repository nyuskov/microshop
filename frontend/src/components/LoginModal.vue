<template>
  <Dialog
    v-model:visible="shouldShowModal"
    modal
    :closable="false"
    :dismissable-mask="false"
    :close-on-escape="false"
    :show-header="false"
    :style="{ width: '400px' }"
    :contentStyle="{ padding: '26px 28px', borderRadius: '18px', overflow: 'hidden' }"
  >
    <Login
      @close-modal="handleLoginClose"
      :initial-state="state"
      @state-changed="handleStateChanged"
    />
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Login from './Login.vue'
import { useAuthStore } from '../stores/auth'

const props = defineProps<{
  visible: boolean
  initialState?: 'phone' | 'otp'
}>()

const emit = defineEmits<{
  'close-modal': []
}>()

const authStore = useAuthStore()

// Вычисляемое свойство, которое учитывает статус аутентификации
const shouldShowModal = computed({
  get: () => {
    // Не показываем модалку, если пользователь уже аутентифицирован
    if (authStore.isAuthenticated) {
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

const state = ref<'phone' | 'otp'>(props.initialState || 'phone')

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
  emit('close-modal')
}

// Обработка события от Login.vue, когда состояние меняется (phone -> otp)
const handleStateChanged = (newState: 'phone' | 'otp') => {
  state.value = newState
}
</script>
