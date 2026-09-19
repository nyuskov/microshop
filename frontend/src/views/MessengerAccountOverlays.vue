<template>
  <!-- Вход: показывается, пока человек не авторизован. -->
  <LoginModal :visible="loginVisible" @close-modal="loginVisible = false" />

  <!-- Новый вход в аккаунт (из push «Это не я» / `?security=1`). -->
  <SecurityAlertDialog v-model="showSecurityAlert" />

  <!-- Собеседник сменил ключ шифрования: спрашиваем, его ли это устройство. -->
  <PeerKeyChangedDialog
    v-model="showPeerKeyChanged"
    :peer-name="peerName"
    @accept="acceptChangedPeerKey"
  />
</template>

<script setup lang="ts">
/**
 * Оверлеи входа и безопасности: экран входа, тревога «новый вход в аккаунт» и
 * предупреждение о смене ключа шифрования собеседника.
 *
 * Состояние этих диалогов живёт здесь, потому что открывают их внешние события
 * (статус авторизации, адрес `?security=1`, push о новом входе, событие E2EE) —
 * представление просто зовёт нужный метод. Имя собеседника для предупреждения
 * ищется функцией из представления: там чаты и контакты.
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import LoginModal from '@/components/LoginModal.vue'
import SecurityAlertDialog from '@/components/messenger/SecurityAlertDialog.vue'
import PeerKeyChangedDialog from '@/components/messenger/PeerKeyChangedDialog.vue'
import { acceptPeerKey, type PeerKeyChange } from '@/services/e2ee'

const props = defineProps<{
  /** Имя собеседника по id (пусто — покажем без имени). */
  peerNameFor: (userId: number) => string
}>()

const router = useRouter()

/** Вход показывается, пока человек не авторизован (см. `setLoginVisible`). */
const loginVisible = ref(true)

/**
 * Экран входа показывает представление по статусу авторизации: и при запуске
 * без сессии, и после выхода из аккаунта.
 */
const setLoginVisible = (visible: boolean) => {
  loginVisible.value = visible
}

/**
 * Диалог «Новый вход в аккаунт».
 *
 * Показывается, если приложение открыли из push о новом входе (`?security=1`)
 * или пришло сообщение от service worker: у владельца должно быть действие в
 * один тап — завершить чужие сессии или заморозить аккаунт.
 */
const showSecurityAlert = ref(
  typeof window === 'undefined'
    ? false
    : new URLSearchParams(window.location.search).get('security') === '1'
)

const openSecurityAlert = () => {
  showSecurityAlert.value = true
}

/** Убираем `?security=1` из адреса, чтобы перезагрузка не открывала диалог снова. */
const clearSecurityParam = () => {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('security')) return
    url.searchParams.delete('security')
    router.options.history.replace(
      `${url.pathname}${url.search}${url.hash}`,
      window.history.state ?? {}
    )
  } catch {
    /* адрес недоступен — не критично */
  }
}

watch(showSecurityAlert, (open) => {
  if (!open) clearSecurityParam()
})

/**
 * Предупреждение о смене ключа шифрования собеседника.
 *
 * Ключ E2EE привязан к устройству: он меняется, когда человек заходит с нового
 * телефона (нормально) — и ровно так же выглядит подмена ключа тем, кто угнал
 * аккаунт и хочет читать чужую переписку. Сервер эти случаи не различает, а
 * человек — да, поэтому спрашиваем его, а не шифруем молча.
 */
const showPeerKeyChanged = ref(false)
const peerKeyChanged = ref<PeerKeyChange | null>(null)

/** Имя собеседника для текста предупреждения (с учётом моего имени контакта). */
const peerName = computed<string>(() =>
  peerKeyChanged.value ? props.peerNameFor(peerKeyChanged.value.userId) : ''
)

/** Событие E2EE: собеседник сменил ключ — показываем предупреждение. */
const openPeerKeyChanged = (change: PeerKeyChange) => {
  peerKeyChanged.value = change
  showPeerKeyChanged.value = true
}

/** «Понятно, это его устройство»: запоминаем устройство и ключ — больше не спрашиваем. */
const acceptChangedPeerKey = () => {
  const change = peerKeyChanged.value
  if (change) acceptPeerKey(change.userId, change.deviceId, change.current)
  peerKeyChanged.value = null
}

defineExpose({ setLoginVisible, openSecurityAlert, openPeerKeyChanged })
</script>
