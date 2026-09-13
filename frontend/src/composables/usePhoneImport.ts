import { computed, ref } from 'vue'
import { matchUsersByPhone, type SearchUserResult } from '@/services/chatService'
import { getErrorMessage } from '@/services/errors'

interface NativePhoneContact {
  name?: string | string[]
  tel?: string[]
}
interface NavigatorWithContacts extends Navigator {
  contacts?: {
    select(props: string[], options: { multiple: boolean }): Promise<NativePhoneContact[]>
  }
}

export interface PhoneImportDeps {
  /** Открыть чат с найденным пользователем (что именно открывать — решает представление). */
  openChat: (user: SearchUserResult) => Promise<void> | void
}

/**
 * Импорт контактов из телефонной книги и поиск людей по номерам.
 *
 * На Android Chrome/Edge (и в PWA) браузер умеет отдавать контакты сам — тогда
 * книгу открываем сразу. На десктопе такого API нет, поэтому показываем окно с
 * вставкой номеров вручную. Найденных показываем прямо в списке контактов: это
 * один и тот же экран, а не отдельный мастер.
 */
export function usePhoneImport(deps: PhoneImportDeps) {
  const phoneImportOpen = ref(false)
  const phoneBusy = ref(false)
  const phoneError = ref('')
  const manualPhones = ref('')
  const phoneMatched = ref<SearchUserResult[] | null>(null)

  /** Поддерживает ли браузер системный выбор контактов (Android Chrome/Edge, PWA). */
  const phoneContactsSupported = computed<boolean>(() => {
    const nav = navigator as NavigatorWithContacts
    return typeof nav.contacts?.select === 'function'
  })

  const openPhoneImport = () => {
    phoneImportOpen.value = true
    phoneError.value = ''
    phoneMatched.value = null
    manualPhones.value = ''
  }

  const closePhoneImport = () => {
    if (phoneBusy.value) return
    phoneImportOpen.value = false
  }

  const normalizePhone = (raw: string): string => raw.replace(/\D/g, '')

  /** Запускает поиск пользователей по номерам. */
  const runPhoneMatch = async (phones: string[]) => {
    phoneError.value = ''
    const clean = phones.map(normalizePhone).filter((p) => p.length >= 7)
    if (clean.length === 0) {
      phoneError.value = 'Не удалось определить номера. Проверьте ввод.'
      phoneMatched.value = []
      return
    }
    phoneBusy.value = true
    try {
      phoneMatched.value = await matchUsersByPhone(clean)
    } catch (error) {
      phoneError.value = getErrorMessage(error, 'Не удалось найти в мессенджере')
    } finally {
      phoneBusy.value = false
    }
  }

  /** Выбор контактов из системной книги. */
  const pickDeviceContacts = async () => {
    const nav = navigator as NavigatorWithContacts
    if (!nav.contacts) return
    phoneBusy.value = true
    phoneError.value = ''
    try {
      const contacts = await nav.contacts.select(['tel', 'name'], { multiple: true })
      const phones = contacts.flatMap((c) => c.tel ?? [])
      await runPhoneMatch(phones)
    } catch (error) {
      const err = error as { name?: string }
      // Отмена выбора — не ошибка.
      if (err?.name && err.name !== 'NotAllowedError') {
        phoneError.value = getErrorMessage(error, 'Не удалось открыть контакты')
      }
    } finally {
      phoneBusy.value = false
    }
  }

  /** Убирает результаты импорта из книги (крестик). */
  const clearPhoneMatch = () => {
    phoneMatched.value = null
    phoneError.value = ''
  }

  /**
   * «Добавить из контактов телефона»: сразу открываем системную книгу,
   * без промежуточного окна. Результаты показываем прямо в списке контактов.
   * Если браузер не умеет открывать книгу (десктоп) — вставка номеров вручную.
   */
  const onAddFromPhone = () => {
    phoneError.value = ''
    phoneMatched.value = null
    if (phoneContactsSupported.value) {
      void pickDeviceContacts()
    } else {
      openPhoneImport()
    }
  }

  /** Поиск по вставленным вручную номерам. */
  const findByManualPhones = () => {
    const lines = manualPhones.value.split(/[\n,;]+/)
    void runPhoneMatch(lines)
  }

  /** Открыть чат с пользователем, найденным по номеру. */
  const openPhoneMatch = async (user: SearchUserResult) => {
    phoneImportOpen.value = false
    phoneMatched.value = null
    phoneError.value = ''
    await deps.openChat(user)
  }

  return {
    phoneImportOpen,
    phoneBusy,
    phoneError,
    manualPhones,
    phoneMatched,
    phoneContactsSupported,
    openPhoneImport,
    closePhoneImport,
    pickDeviceContacts,
    clearPhoneMatch,
    onAddFromPhone,
    findByManualPhones,
    openPhoneMatch,
    normalizePhone
  }
}
