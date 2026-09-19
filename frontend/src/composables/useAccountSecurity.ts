/**
 * Безопасность аккаунта в профиле: журнал событий, подтверждение e-mail, смена
 * пароля, активные входы (устройства), заморозка и «выйти на всех устройствах».
 *
 * Вынесено из `views/UserProfile.vue`: это одна тема («что происходит с моим
 * аккаунтом и как его защитить»), а профиль только рисует разделы. Стор берём
 * напрямую — это не параметр, а тот же самый стор; наружу уходят лишь настоящие
 * зависимости профиля: запасной адрес из формы и закрытие окна.
 */

import { computed, reactive, ref } from 'vue'

import { useAuthStore, type AuthSession as AuthSessionRow } from '@/stores/auth'
import { getErrorMessage } from '@/services/errors'
import { deviceLabelOf, fetchSecurityLog, type SecurityLogEntry } from '@/services/securityLog'
import { askTextDialog, confirmDialog } from '@/utils/appDialogs'
import { parseServerTime } from '@/utils/format'
import { passwordProblem, passwordStrength } from '@/utils/passwordPolicy'

/** Сколько событий журнала показываем (сервер хранит 180 дней). */
const SECURITY_LOG_LIMIT = 20

export interface AccountSecurityDeps {
  /** E-mail из формы профиля: если в аккаунте адреса ещё нет, код отправим туда. */
  emailFallback: () => string
  /** Закрыть окно профиля (после выхода, заморозки, отзыва своего входа). */
  closeModal: () => void
}

export function useAccountSecurity(deps: AccountSecurityDeps) {
  const authStore = useAuthStore()

  // ---------- Журнал безопасности: что происходило с аккаунтом ----------
  // Входы (в т.ч. неудачные), запросы кодов, подтверждение нового устройства,
  // смена пароля/e-mail, отзыв сессий. Помогает разобрать инцидент: «кто-то заходил
  // в мой аккаунт?», «когда сменили пароль?».
  const securityLog = ref<SecurityLogEntry[]>([])
  const securityLogLoading = ref(false)
  const securityLogError = ref('')

  const loadSecurityLog = async () => {
    securityLogLoading.value = true
    securityLogError.value = ''
    try {
      securityLog.value = await fetchSecurityLog(SECURITY_LOG_LIMIT)
    } catch (error) {
      console.error('Security log failed:', error)
      securityLogError.value = 'Не удалось загрузить историю действий.'
    } finally {
      securityLogLoading.value = false
    }
  }

  void loadSecurityLog()

  // ---------- Что не так с защитой аккаунта ----------
  // Предупреждаем, если вход не защищён: пароля нет, пароль слабый (задан до
  // появления политики) или не указан e-mail для восстановления.
  const emailChannelAvailable = ref(false)

  void authStore
    .fetchAuthChannels()
    .then((channels) => {
      emailChannelAvailable.value = channels.email_otp_available
    })
    .catch(() => {
      emailChannelAvailable.value = false
    })

  const securityIssues = computed<string[]>(() => {
    const user = authStore.current_user
    if (!user) return []
    const issues: string[] = []
    if (!user.password_set) {
      issues.push('Задайте пароль — сейчас вход возможен только по коду в Telegram.')
    } else if (user.password_weak) {
      issues.push('Пароль слабый — замените его на длинную фразу.')
    }
    if (!user.email) {
      issues.push('Добавьте e-mail — он понадобится для восстановления доступа.')
    } else if (!user.email_verified && emailChannelAvailable.value) {
      issues.push(
        'Подтвердите e-mail — только подтверждённый адрес годится для входа и сброса пароля.'
      )
    }
    return issues
  })

  // ---------- Подтверждение e-mail: код из письма ----------
  const emailCodeSent = ref(false)
  const emailCodeInput = ref('')
  const emailBusy = ref(false)
  const emailNotice = ref('')
  const emailError = ref('')

  /** Адрес, на который отправим код: из аккаунта, иначе из формы профиля. */
  const emailAddress = (): string => (authStore.current_user?.email ?? deps.emailFallback()).trim()

  const sendEmailCode = async () => {
    const address = emailAddress()
    if (!address) {
      emailError.value = 'Сначала укажите e-mail и сохраните профиль.'
      return
    }

    emailBusy.value = true
    emailError.value = ''
    emailNotice.value = ''
    try {
      const detail = await authStore.requestEmailVerification(address)
      emailCodeSent.value = true
      emailNotice.value = detail || 'Код отправлен на e-mail.'
    } catch (error) {
      emailError.value = getErrorMessage(error, 'Не удалось отправить код')
    } finally {
      emailBusy.value = false
    }
  }

  const confirmEmailCode = async () => {
    const address = emailAddress()
    if (!emailCodeInput.value.trim()) {
      emailError.value = 'Введите код из письма.'
      return
    }

    emailBusy.value = true
    emailError.value = ''
    emailNotice.value = ''
    try {
      await authStore.confirmEmailVerification(address, emailCodeInput.value.trim())
      emailCodeSent.value = false
      emailCodeInput.value = ''
      emailNotice.value =
        'E-mail подтверждён — теперь по нему можно входить и восстанавливать пароль.'
    } catch (error) {
      emailError.value = getErrorMessage(error, 'Неверный код из письма')
    } finally {
      emailBusy.value = false
    }
  }

  // ---------- Пароль ----------
  const passwordForm = reactive({
    current: '',
    next: '',
    confirm: ''
  })
  /** Показ пароля («глазок») — отдельно по каждому полю. */
  const passwordVisible = reactive({ current: false, next: false, confirm: false })
  const passwordSaving = ref(false)
  const passwordNotice = ref('')
  const passwordError = ref('')

  /** Что не так с новым паролем (подсказка под полем), пусто — всё хорошо. */
  const passwordProblemOf = (value: string): string | null =>
    passwordProblem(value, {
      phoneNumber: authStore.current_user?.phone_number,
      email: deps.emailFallback() || authStore.current_user?.email,
      username: authStore.current_user?.username
    })

  const passwordHint = computed(() => {
    if (!passwordForm.next) return ''
    return passwordProblemOf(passwordForm.next)
  })

  const passwordScore = computed(() => passwordStrength(passwordForm.next))

  const resetPasswordForm = () => {
    passwordForm.current = ''
    passwordForm.next = ''
    passwordForm.confirm = ''
    passwordVisible.current = false
    passwordVisible.next = false
    passwordVisible.confirm = false
  }

  const changePassword = async () => {
    if (passwordSaving.value) return

    const problem = passwordProblemOf(passwordForm.next)
    if (problem) {
      passwordError.value = problem
      passwordNotice.value = ''
      return
    }
    if (passwordForm.next !== passwordForm.confirm) {
      passwordError.value = 'Пароли не совпадают.'
      passwordNotice.value = ''
      return
    }

    passwordSaving.value = true
    passwordError.value = ''
    passwordNotice.value = ''
    try {
      const needsCurrent = authStore.current_user?.password_set === true
      await authStore.setPassword(
        passwordForm.next,
        needsCurrent ? passwordForm.current : undefined
      )
      await authStore.fetchUser()
      resetPasswordForm()
      passwordNotice.value = 'Пароль обновлён. Остальные устройства вышли из аккаунта.'
    } catch (error) {
      passwordError.value = getErrorMessage(error, 'Не удалось изменить пароль')
    } finally {
      passwordSaving.value = false
    }
  }

  const doRevokeAllSessions = async () => {
    if (passwordSaving.value) return

    passwordSaving.value = true
    passwordError.value = ''
    passwordNotice.value = ''
    try {
      await authStore.revokeAllSessions()
      await authStore.logout()
      deps.closeModal()
    } catch (error) {
      passwordError.value = getErrorMessage(error, 'Не удалось выйти на всех устройствах')
    } finally {
      passwordSaving.value = false
    }
  }

  // ---------- Активные входы (устройства): список + отзыв одного входа ----------
  // Показываем устройство, IP и время входа: так владелец видит чужие сессии.
  // «Текущий» вход сервер определяет по отпечатку браузера/приложения (User-Agent).
  const sessions = ref<AuthSessionRow[]>([])
  const sessionsLoading = ref(false)
  const sessionsError = ref('')
  const sessionsNotice = ref('')

  const loadSessions = async () => {
    sessionsLoading.value = true
    sessionsError.value = ''
    try {
      sessions.value = await authStore.fetchSessions()
    } catch (error) {
      sessionsError.value = getErrorMessage(error, 'Не удалось загрузить устройства')
    } finally {
      sessionsLoading.value = false
    }
  }

  void loadSessions()

  const revokeSessionRow = async (row: AuthSessionRow) => {
    if (sessionsLoading.value) return
    sessionsLoading.value = true
    sessionsError.value = ''
    sessionsNotice.value = ''
    try {
      await authStore.revokeSession(row.id)
      if (row.current) {
        // Отозвали собственный вход — дальше работать нечем, выходим локально.
        await authStore.logout()
        deps.closeModal()
        return
      }
      sessions.value = sessions.value.filter((item) => item.id !== row.id)
      sessionsNotice.value = 'Устройство вышло из аккаунта.'
    } catch (error) {
      sessionsError.value = getErrorMessage(error, 'Не удалось отозвать устройство')
    } finally {
      sessionsLoading.value = false
    }
  }

  /** Короткая подпись устройства: браузер/ОС вместо полной строки User-Agent. */
  const deviceLabel = (agent: string): string => deviceLabelOf(agent) || 'Неизвестное устройство'

  /** Операционная система по строке User-Agent (для подписи под устройством). */
  const platformLabel = (agent: string): string => {
    if (/android/i.test(agent)) return 'Android'
    if (/(iphone|ipad|ipod)/i.test(agent)) return 'iOS'
    if (/windows/i.test(agent)) return 'Windows'
    if (/mac os x/i.test(agent)) return 'macOS'
    if (/linux/i.test(agent)) return 'Linux'
    return ''
  }

  /** Дата и время входа в читаемом виде. */
  const sessionTime = (iso: string): string => {
    const date = parseServerTime(iso)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const doLogout = async () => {
    try {
      await authStore.logout()
    } finally {
      deps.closeModal()
    }
  }

  // ---------- Заморозка аккаунта («стоп-кран» при угоне) ----------
  const freezeBusy = ref(false)
  const freezeError = ref('')

  /**
   * Заморозка: все сессии гаснут, вход закрыт до подтверждения владения почтой.
   *
   * Если пароль у аккаунта уже задан — сервер потребует его: иначе чужой человек
   * с угнанной сессией мог бы «заморозить» аккаунт владельцу (DoS).
   */
  const startFreeze = async () => {
    if (freezeBusy.value) return
    let password: string | undefined
    if (authStore.user?.password_set) {
      const entered = await askTextDialog({
        title: 'Заморозка аккаунта',
        message:
          'Подтвердите паролем — так «заморозить» аккаунт не сможет тот, кто получил доступ к вашей сессии.',
        label: 'Пароль',
        type: 'password',
        okLabel: 'Продолжить',
        isValid: (value) => value.length > 0
      })
      if (entered === null) return
      password = entered
    }
    const confirmed = await confirmDialog({
      title: 'Заморозить аккаунт?',
      message: 'Все устройства выйдут, вход будет закрыт до разморозки кодом из письма.',
      okLabel: 'Заморозить',
      danger: true
    })
    if (!confirmed) return
    freezeBusy.value = true
    freezeError.value = ''
    try {
      await authStore.freezeAccount(password)
      deps.closeModal()
    } catch (error) {
      freezeError.value = getErrorMessage(error, 'Не удалось заморозить аккаунт')
    } finally {
      freezeBusy.value = false
    }
  }

  return {
    securityLog,
    securityLogLoading,
    securityLogError,
    loadSecurityLog,
    securityIssues,
    emailChannelAvailable,
    emailCodeSent,
    emailCodeInput,
    emailBusy,
    emailNotice,
    emailError,
    sendEmailCode,
    confirmEmailCode,
    passwordForm,
    passwordVisible,
    passwordSaving,
    passwordNotice,
    passwordError,
    passwordHint,
    passwordScore,
    resetPasswordForm,
    changePassword,
    doRevokeAllSessions,
    sessions,
    sessionsLoading,
    sessionsError,
    sessionsNotice,
    loadSessions,
    revokeSessionRow,
    deviceLabel,
    platformLabel,
    sessionTime,
    doLogout,
    freezeBusy,
    freezeError,
    startFreeze
  }
}
