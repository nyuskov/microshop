<script setup lang="ts">
import { icon } from '@/utils/icons'
import { reactive, ref, watch, computed, nextTick, defineAsyncComponent } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { getErrorMessage } from '@/services/errors'
import { useAccountSecurity } from '@/composables/useAccountSecurity'
import { useMobileLayer } from '@/composables/useMobileOverlay'
import { removeAvatar, uploadAvatar } from '@/services/api'
import { LOCALES, plural, t } from '@/i18n'
import { mediaUrl } from '@/services/chatService'
import { optimizeAvatarFile } from '@/utils/media'
import { formatPhoneForBackend, localPhoneDigits, maskPhoneLocal } from '@/utils/phone'
import {
  caretAfterDateDigits,
  dateDigits,
  dateToIso,
  isoToDateMask,
  maskDate,
  validateBirthDate
} from '@/utils/dateInput'
import { avatarStyle as userAvatarStyle, initials as userInitials } from '@/utils/user'
import { profileLinkFor } from '@/utils/profileLink'
import {
  checkForAppUpdate,
  disablePushNotifications,
  enablePushNotifications
} from '@/services/pwa'
import { disableNativePush, enableNativePush, isNativeApp } from '@/services/nativePush'
import { fetchStorageInfo, formatBytes, type StorageInfo } from '@/services/storage'
import { clearAppCache, readDeviceCache, type DeviceCacheInfo } from '@/utils/deviceCache'
import {
  clearLocalSearch,
  isLocalSearchEnabled,
  localSearchCount,
  setLocalSearchEnabled
} from '@/utils/localSearchIndex'
import { isMessageSoundEnabled, setMessageSoundEnabled } from '@/utils/sounds'
import { deviceLabelOf, formatEventTime, isAlertEvent } from '@/services/securityLog'
import { PASSWORD_MIN_LENGTH } from '@/utils/passwordPolicy'
import {
  QUIET_DEFAULT_END,
  QUIET_DEFAULT_START,
  formatOffset,
  localUtcOffsetMinutes,
  quietHoursSummary,
  timeOptions
} from '@/utils/quietHours'
import DeleteAccountDialog from '@/components/messenger/DeleteAccountDialog.vue'
import SelectField from '@/components/common/SelectField.vue'
import QrCode from '@/components/common/QrCode.vue'
import InvitesSettings from '@/components/messenger/InvitesSettings.vue'
import AppearanceSettings from '@/views/AppearanceSettings.vue'

const emit = defineEmits(['close-modal'])

const authStore = useAuthStore()

/**
 * Служебные разделы («Технические работы», «Жалобы») грузятся отдельными
 * чанками: они нужны только администратору и лишь тогда, когда он их откроет, а
 * чанк профиля с ними внутри выходил за бюджет размера
 * (проверка `check-bundle-size.mjs`).
 */
const MaintenanceSettings = defineAsyncComponent(
  () => import('@/components/messenger/MaintenanceSettings.vue')
)

const ModerationReportsSection = defineAsyncComponent(
  () => import('@/components/messenger/ModerationReportsSection.vue')
)

/**
 * Раздел «Устройство» — что умеет этот браузер.
 *
 * Тоже ленивый: проверки простые, но разметка с подсказками нужна раз в жизни,
 * а профиль грузится на телефоне.
 */
const DeviceSettings = defineAsyncComponent(
  () => import('@/components/messenger/DeviceSettings.vue')
)

/**
 * Диалог резервной копии ключа шифрования — тоже ленивый: нужен редко, а чанк
 * профиля с ним внутри выходит за бюджет (`check-bundle-size.mjs`).
 */
const E2eeBackupDialog = defineAsyncComponent(
  () => import('@/components/messenger/E2eeBackupDialog.vue')
)

const COUNTRIES = [
  { code: 'RU', name: 'Россия' },
  { code: 'BY', name: 'Беларусь' },
  { code: 'KZ', name: 'Казахстан' },
  { code: 'US', name: 'США' },
  { code: 'DE', name: 'Германия' },
  { code: 'ES', name: 'Испания' },
  { code: 'FR', name: 'Франция' }
]

/**
 * Варианты для выпадающих списков «Язык» и «Страна».
 *
 * Пустое значение стоит вариантом в списке (а не плейсхолдером): человек должен
 * уметь снять выбор, как это было в родном списке («Не выбран»/«Не выбрана»).
 *
 * Языки берутся из `LOCALES` — то есть только те, на которых интерфейс реально
 * умеет работать. Раньше список был шире (es/de/fr), но выбор ничего не менял.
 */
const LANGUAGE_OPTIONS = computed(() => [
  { value: '', label: t('Не выбран') },
  ...LOCALES.map((lang) => ({ value: lang.code, label: lang.label }))
])

const COUNTRY_OPTIONS = computed(() => [
  { value: '', label: t('Не выбрана') },
  ...COUNTRIES.map((country) => ({ value: country.code, label: t(country.name) }))
])

interface ProfileForm {
  username: string
  first_name: string
  last_name: string
  phone_number: string
  email: string
  status: string
  bio: string
  birth_date: string
  language: string
  country: string
  notifications_enabled: boolean
  privacy_mode: boolean
  notification_preview: boolean
  quiet_hours_enabled: boolean
  quiet_hours_start: number
  quiet_hours_end: number
  quiet_hours_allow_calls: boolean
  quiet_hours_offset: number
}

const profileForm = reactive<ProfileForm>({
  username: '',
  first_name: '',
  last_name: '',
  phone_number: '',
  email: '',
  status: '',
  bio: '',
  birth_date: '',
  language: '',
  country: '',
  notifications_enabled: true,
  privacy_mode: false,
  notification_preview: true,
  quiet_hours_enabled: false,
  quiet_hours_start: QUIET_DEFAULT_START,
  quiet_hours_end: QUIET_DEFAULT_END,
  quiet_hours_allow_calls: true,
  // Сдвиг пояса берём у устройства: сервер про пояс ничего не знает.
  quiet_hours_offset: localUtcOffsetMinutes()
})

watch(
  () => authStore.current_user,
  (user) => {
    if (!user) return
    const profile = user.profile
    profileForm.username = user.username ?? ''
    profileForm.first_name = user.first_name ?? ''
    profileForm.last_name = user.last_name ?? ''
    profileForm.phone_number = user.phone_number ? formatPhoneForBackend(user.phone_number) : ''
    profileForm.email = user.email ?? ''
    profileForm.status = user.status ?? ''
    profileForm.bio = profile?.bio ?? ''
    // Дата хранится как ISO (YYYY-MM-DD), а в поле показывается маской ДД.ММ.ГГГГ.
    profileForm.birth_date = isoToDateMask(profile?.birth_date)
    profileForm.language = profile?.language ?? ''
    profileForm.country = profile?.country ?? ''
    profileForm.notifications_enabled = profile?.notifications_enabled ?? true
    profileForm.privacy_mode = profile?.privacy_mode ?? false
    profileForm.notification_preview = profile?.notification_preview ?? true
    profileForm.quiet_hours_enabled = profile?.quiet_hours_enabled ?? false
    profileForm.quiet_hours_start = profile?.quiet_hours_start ?? QUIET_DEFAULT_START
    profileForm.quiet_hours_end = profile?.quiet_hours_end ?? QUIET_DEFAULT_END
    profileForm.quiet_hours_allow_calls = profile?.quiet_hours_allow_calls ?? true
    profileForm.quiet_hours_offset = profile?.quiet_hours_offset ?? localUtcOffsetMinutes()
  },
  { immediate: true }
)

// ---------- Разделы настроек ----------
// Профиль открывается списком разделов: на одном экране было слишком много всего
// (личные данные, пароль, сессии, журнал входов, хранилище) — теперь у каждого
// раздела своя страница, как в мессенджерах на телефоне.
type SettingsSection =
  | 'root'
  | 'account'
  | 'security'
  | 'privacy'
  | 'notifications'
  | 'storage'
  | 'link'
  | 'admin'
  | 'invites'
  | 'maintenance'
  | 'reports'
  | 'appearance'
  | 'device'
  | 'about'

interface SettingsRow {
  key: Exclude<SettingsSection, 'root' | 'admin' | 'invites' | 'maintenance' | 'reports'>
  icon: string
  title: string
  desc: string
}

/**
 * Пункт в списке настроек: обычный раздел или админский экран.
 *
 * Служебные разделы (приглашения, жалобы, техработы) собраны на отдельном
 * экране. Раньше в него вела плавающая «шестерёнка» внизу списка чатов, но значок
 * в панели чатов читался как ещё один элемент списка и мешал (владелец: «значок
 * администрирования убрать, добавить пунктом в настройки»).
 */
interface SettingsEntry {
  key: SettingsRow['key'] | 'admin'
  icon: string
  title: string
  desc: string
}

/**
 * Пункт админского экрана: «invites», «maintenance» и «reports» — реальные
 * разделы служебного экрана (раньше «reports» открывался отдельным диалогом
 * модерации). Открываются по нажатию — как обычные строки настроек.
 */
interface AdminRow {
  key: 'invites' | 'maintenance' | 'reports'
  icon: string
  title: string
  desc: string
}

const SETTINGS_ROWS: SettingsRow[] = [
  { key: 'account', icon: 'person', title: 'Аккаунт', desc: 'Имя, логин, статус, контакты' },
  {
    key: 'security',
    icon: 'shield',
    title: 'Безопасность',
    desc: t('Пароль, e-mail, устройства, журнал входов')
  },
  { key: 'privacy', icon: 'lock', title: 'Приватность', desc: 'Видимость профиля в поиске' },
  { key: 'notifications', icon: 'notifications', title: 'Уведомления', desc: 'Push-уведомления' },
  { key: 'storage', icon: 'cloud', title: 'Хранилище', desc: 'Сколько занимают вложения' },
  { key: 'link', icon: 'share', title: 'Моя ссылка', desc: 'Ссылка на ваш профиль' },
  {
    key: 'appearance',
    icon: 'palette',
    title: 'Внешний вид',
    desc: t('Тема, обои, размер текста')
  },
  {
    key: 'device',
    icon: 'devices',
    title: 'Устройство',
    desc: t('Что работает в этом браузере и что докачать')
  },
  { key: 'about', icon: 'info', title: 'О приложении', desc: 'Документы и версия' }
]

// Раздел владельца сервиса: публичной регистрации нет, аккаунты заводятся по
// личным ссылкам. Служебные вещи не мешаются в обычных настройках профиля —
// они живут на отдельном экране, вход в который — пункт «Администрирование» в
// списке настроек (виден только аккаунту администратора).
const ADMIN_ROWS: AdminRow[] = [
  {
    key: 'invites',
    icon: 'person_add',
    title: 'Приглашения',
    desc: t('Ссылки на регистрацию для новых людей')
  },
  {
    key: 'maintenance',
    icon: 'warning',
    title: 'Технические работы',
    desc: t('Закрыть приложение на время обновления')
  },
  {
    key: 'reports',
    icon: 'flag',
    title: 'Жалобы',
    desc: t('Разбор жалоб и журнал модерации')
  }
]

const section = ref<SettingsSection>('root')

/**
 * Пункты админского экрана для этого аккаунта.
 *
 * «Технические работы» — рубильник, который закрывает сервис всем: это право
 * владельца (`is_superuser`). Администратору (`is_admin`) доступны приглашения
 * и жалобы, обход заглушки техработ — но не сам рубильник (сервер его тоже не
 * отдаст: `PUT /system/maintenance/` требует владельца).
 */
const adminRows = computed<AdminRow[]>(() =>
  ADMIN_ROWS.filter((row) => row.key !== 'maintenance' || authStore.isOwner).map((row) => ({
    ...row,
    title: t(row.title),
    desc: t(row.desc)
  }))
)

/** Вход в служебный экран — самый последний пункт списка настроек. */
const ADMIN_ENTRY: SettingsEntry = {
  key: 'admin',
  icon: 'admin_panel_settings',
  title: 'Администрирование',
  // Подпись в одну строку — как у остальных пунктов: длинная переносилась на
  // две строки, и пункт выглядел выше и «криво» по сравнению с соседями
  // (замечание владельца).
  desc: t('Приглашения, жалобы, техработы')
}

/**
 * Пункты настроек: обычные разделы и, у админа, вход в служебный экран.
 *
 * Подписи переводим здесь: списки разделов — данные модуля (не реактивны), а
 * язык интерфейса меняется на лету.
 */
const settingsEntries = computed<SettingsEntry[]>(() =>
  (authStore.isAdmin ? [...SETTINGS_ROWS, ADMIN_ENTRY] : SETTINGS_ROWS).map((row) => ({
    ...row,
    title: t(row.title),
    desc: t(row.desc)
  }))
)

/** Информация о сборке (подставляется vite при сборке). */
const buildInfo = __BUILD_INFO__

/** Раздел «О приложении»: проверка обновлений PWA. */
const updatingApp = ref(false)
const aboutNotice = ref('')

const checkForUpdates = async () => {
  updatingApp.value = true
  aboutNotice.value = ''
  try {
    const found = await checkForAppUpdate()
    // Найденное обновление перезагружает страницу само, поэтому сообщение — про
    // обратный случай.
    if (!found) aboutNotice.value = t('Обновлений нет — версия свежая.')
  } catch (error) {
    aboutNotice.value = getErrorMessage(error, t('Не удалось проверить обновления'))
  } finally {
    updatingApp.value = false
  }
}

/** Приватный режим сохраняется сразу: в разделе нет отдельной кнопки «Сохранить». */
const onPrivacyToggle = async () => {
  await updateProfile()
}

/**
 * «Показывать текст сообщения» — тоже сразу: в уведомлениях нет кнопки
 * «Сохранить» (как и у приватности), а текст на экране блокировки — то, что
 * человек хочет поменять одной галочкой.
 */
const onPreviewToggle = async () => {
  await updateProfile()
}

/**
 * Звук сообщений — настройка УСТРОЙСТВА (как тип звонка), поэтому она живёт в
 * localStorage и сохраняется сразу: на телефоне и на компьютере человек может
 * хотеть разное, а на сервер это знание не нужно.
 */
const messageSoundEnabled = ref(isMessageSoundEnabled())

const onMessageSoundToggle = (val: boolean) => {
  setMessageSoundEnabled(val)
  messageSoundEnabled.value = val
}
const currentSectionTitle = computed(() => {
  if (section.value === 'admin') return t('Администрирование')
  const row =
    SETTINGS_ROWS.find((item) => item.key === section.value) ??
    ADMIN_ROWS.find((item) => item.key === section.value)
  return row ? t(row.title) : t('Настройки')
})

const settingsQuery = ref('')

/** Разделы под поиском: ищем по названию и описанию. */
const visibleSettingsEntries = computed<SettingsEntry[]>(() => {
  const query = settingsQuery.value.trim().toLowerCase()
  if (!query) return settingsEntries.value
  return settingsEntries.value.filter(
    (row) => row.title.toLowerCase().includes(query) || row.desc.toLowerCase().includes(query)
  )
})

/** Открыть раздел настроек. */
const openSection = (key: SettingsEntry['key']) => {
  section.value = key
}

/**
 * Вернуться на шаг назад: из админского раздела — к списку админских, из
 * обычного раздела — к списку настроек. Ведём себя как «назад» в приложении,
 * а не всегда выкидываем на главный экран.
 */
const ADMIN_SECTIONS: SettingsSection[] = ['invites', 'maintenance', 'reports']

const backToSections = () => {
  section.value = ADMIN_SECTIONS.includes(section.value) ? 'admin' : 'root'
}

/** Нажатие в служебном списке: открываем раздел (своя шапка с «назад» — у него). */
const openAdminRow = (key: AdminRow['key']) => {
  section.value = key
}

// Родителю (Messenger) нужно знать, открыт ли РАЗДЕЛ настроек: тогда «назад»
// возвращает к списку разделов, а не закрывает профиль целиком.
//
// Служебный экран («Администрирование») теперь такой же раздел: вход в него —
// пункт списка настроек, поэтому «назад» из него возвращает к списку, а не
// закрывает окно.
const isInSection = () => section.value !== 'root'
defineExpose({ backToSections, isInSection })

// Раздел настроек (а не список разделов) — отдельный слой мобильной навигации:
// системное «назад» возвращает к списку разделов, а не закрывает настройки и тем
// более не выходит из приложения. Свой шаг в истории у раздела необходим: без
// него на два действия («к списку» + «закрыть настройки») приходился один шаг, и
// второе нажатие уходило системе — на телефоне это выход из приложения прямо
// из-под открытых настроек (см. `composables/useMobileOverlay.ts`).
// Служебный экран («Администрирование») — такой же раздел: вход в него идёт
// пунктом списка настроек, значит и «назад» должен возвращать к списку.
useMobileLayer(isInSection, backToSections)

// ---------- Ссылка на профиль ----------
// Логин уникален в базе, поэтому ссылку можно давать кому угодно: открыв её,
// человек попадает в чат с вами (см. resolveProfileLink в Messenger.vue).
// Номер телефона в ссылке не виден.
const myProfileLink = computed<string | null>(() =>
  profileLinkFor(authStore.current_user?.username ?? null)
)
const linkNotice = ref('')

const copyProfileLink = async () => {
  const link = myProfileLink.value
  if (!link) return
  linkNotice.value = ''
  try {
    await navigator.clipboard.writeText(link)
    linkNotice.value = t('Ссылка скопирована')
  } catch (error) {
    linkNotice.value = getErrorMessage(error, t('Не удалось скопировать ссылку'))
  }
}

// ---------- Отображение ----------
const fullName = computed(() =>
  [profileForm.first_name, profileForm.last_name].filter(Boolean).join(' ').trim()
)

const heroName = computed(() => fullName.value || profileForm.username || t('Пользователь'))

const heroInitials = computed(() => userInitials(heroName.value))

const avatarStyle = computed(() => userAvatarStyle(heroName.value))

// ---------- Сохранение ----------
const saving = ref(false)
const success = ref(false)
const errorMessage = ref('')

// ---------- Аватар ----------
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarUploading = ref(false)
const avatarError = ref('')

const avatarSrc = computed<string | null>(() => {
  // В профиле аватар — кружок ~100px, поэтому берём миниатюру 128px.
  const url = authStore.current_user?.avatar_thumb_url || authStore.current_user?.avatar_url
  return url ? mediaUrl(url) : null
})

const hasAvatar = computed<boolean>(() => !!authStore.current_user?.avatar_url)

const onAvatarSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!file.type.startsWith('image/')) {
    avatarError.value = t('Пожалуйста, выберите изображение')
    return
  }

  avatarUploading.value = true
  avatarError.value = ''
  try {
    // Сжимаем на клиенте до 512px: с телефона приходит снимок в мегабайты.
    const urls = await uploadAvatar(await optimizeAvatarFile(file))
    if (authStore.current_user) {
      authStore.current_user = {
        ...authStore.current_user,
        avatar_url: urls.avatar_url,
        avatar_thumb_url: urls.avatar_thumb_url
      }
    }
    await authStore.fetchUser()
  } catch (error) {
    avatarError.value = getErrorMessage(error, t('Не удалось загрузить фото'))
  } finally {
    avatarUploading.value = false
  }
}

const removeAvatarClick = async () => {
  avatarUploading.value = true
  avatarError.value = ''
  try {
    await removeAvatar()
    if (authStore.current_user) {
      authStore.current_user = {
        ...authStore.current_user,
        avatar_url: null,
        avatar_thumb_url: null
      }
    }
    await authStore.fetchUser()
  } catch (error) {
    avatarError.value = getErrorMessage(error, t('Не удалось удалить фото'))
  } finally {
    avatarUploading.value = false
  }
}

const closeModal = () => emit('close-modal')

// ---------- Хранилище: сколько медиа занимает аккаунт ----------
// Квота считается по файлам, которые пользователь загрузил сам (см.
// core/media_quota.py): профиль показывает заполненность заранее, чтобы 413
// «хранилище заполнено» не стал неожиданностью.
const storageInfo = ref<StorageInfo | null>(null)
const storageLoading = ref(false)
/** Место почти закончилось — предупреждаем заранее (порог из настроек сервера). */
const STORAGE_WARN_PERCENT = 90
const storageWarn = computed(() => (storageInfo.value?.percent ?? 0) >= STORAGE_WARN_PERCENT)

const loadStorage = async () => {
  storageLoading.value = true
  try {
    storageInfo.value = await fetchStorageInfo()
  } catch (error) {
    console.error('Storage info failed:', error)
    storageInfo.value = null
  } finally {
    storageLoading.value = false
  }
  await Promise.all([loadDeviceCache(), loadLocalSearchCount()])
}

void loadStorage()

// ---------- Кэш приложения на устройстве (оболочка: страницы, шрифты, иконки) ----------
const deviceCache = ref<DeviceCacheInfo | null>(null)
const cacheClearing = ref(false)
const cacheNotice = ref('')

const loadDeviceCache = async () => {
  deviceCache.value = await readDeviceCache()
}

/** Очистить кэш оболочки: файлы скачаются заново при следующем открытии. */
const onClearAppCache = async () => {
  cacheClearing.value = true
  cacheNotice.value = ''
  try {
    const removed = await clearAppCache()
    await loadDeviceCache()
    cacheNotice.value = removed
      ? t('Готово: удалено файлов — {count}. Переписка не затронута.', { count: removed })
      : t('Кэш уже пуст.')
  } finally {
    cacheClearing.value = false
  }
}

// ---------- Локальный поиск по зашифрованным чатам ----------
//
// В шифрованном чате сервер видит только шифротекст, поэтому искать там может
// лишь само устройство: индекс расшифрованного текста лежит в IndexedDB
// (utils/localSearchIndex.ts). Здесь — тумблер, размер и очистка.
const localSearchOn = ref(isLocalSearchEnabled())
const localSearchSize = ref(0)
const localSearchNotice = ref('')

const loadLocalSearchCount = async () => {
  localSearchSize.value = await localSearchCount()
}

/** Выключили поиск — индекс больше не нужен: текст переписки на устройстве не держим. */
const onToggleLocalSearch = async (value: boolean) => {
  setLocalSearchEnabled(value)
  localSearchNotice.value = value
    ? t(
        'Включено: текст прочитанных сообщений из шифрованных чатов будет запоминаться на этом устройстве'
      )
    : ''
  if (!value) await onClearLocalSearch()
}

const onClearLocalSearch = async () => {
  await clearLocalSearch()
  await loadLocalSearchCount()
  localSearchNotice.value = t('Индекс очищен')
}

// ---------- Журнал безопасности: что происходило с аккаунтом ----------
// ---------- Безопасность аккаунта: журнал, e-mail, пароль, устройства, заморозка ----------
//
// Тема целиком в `composables/useAccountSecurity.ts`: здесь остаётся связь с формой
// профиля (запасной e-mail) и закрытием окна.

const {
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
} = useAccountSecurity({
  emailFallback: () => profileForm.email,
  closeModal: () => emit('close-modal')
})

// ---------- Удаление аккаунта (требование RuStore/152-ФЗ) ----------
const showDeleteAccount = ref(false)
// ---------- Резервная копия ключа шифрования (F2) ----------
const showE2eeBackup = ref(false)

// Диалоги профиля — слои общего стека (см. `composables/useMobileOverlay.ts`):
// с телефона «назад» закрывает открытый диалог, а не сами настройки целиком.
useMobileLayer(
  () => showDeleteAccount.value,
  () => {
    showDeleteAccount.value = false
  }
)
useMobileLayer(
  () => showE2eeBackup.value,
  () => {
    showE2eeBackup.value = false
  }
)

/** Аккаунт удалён на сервере: чистим локальную сессию и закрываем профиль. */
const onAccountDeleted = async () => {
  showDeleteAccount.value = false
  try {
    await authStore.logout()
  } finally {
    emit('close-modal')
  }
}

// ---------- Поле телефона (только для чтения) ----------
// Номер — это логин аккаунта: по нему выдаются коды входа, поэтому менять его
// из профиля нельзя (сервер тоже отклоняет такие запросы — 422).
const phoneFieldValue = computed<string>(() =>
  profileForm.phone_number ? maskPhoneLocal(localPhoneDigits(profileForm.phone_number)) : ''
)

// ---------- Дата рождения ----------
/** Подсказка-ошибка под полем даты ('' — всё в порядке). */
const birthError = ref('')

/**
 * Ввод даты: маска ставит точки, каретка идёт за цифрами.
 *
 * Позицию считаем по цифрам СЛЕВА от каретки (как в поле телефона): иначе при
 * правке в середине строки каретка уезжала бы в конец. Точки добавляются к
 * позиции — их вставляет сама маска.
 */
const onBirthInput = (event: Event) => {
  const input = event.target as HTMLInputElement
  const caret = input.selectionStart ?? input.value.length
  const digitsBefore = dateDigits(input.value.slice(0, caret)).length
  const digits = dateDigits(input.value)
  profileForm.birth_date = maskDate(digits)
  // Пока дату не добили — не ругаемся, но проверяем сразу, когда цифр хватает.
  birthError.value = digits.length === 8 ? (validateBirthDate(digits) ?? '') : ''
  const position = caretAfterDateDigits(Math.min(digitsBefore, digits.length))
  void nextTick(() => input.setSelectionRange(position, position))
}

/** Уход из поля: если дата неполная — объясняем, что именно набрать. */
const onBirthBlur = () => {
  birthError.value = validateBirthDate(profileForm.birth_date) ?? ''
}

const updateProfile = async () => {
  if (saving.value) return

  // Дата в поле — маска ДД.ММ.ГГГГ, на сервер уходит ISO. Неполную/невозможную
  // дату не отправляем, а показываем, что поправить (сервер такую тоже отвергнет).
  const birthProblem = validateBirthDate(profileForm.birth_date)
  if (birthProblem) {
    birthError.value = birthProblem
    return
  }
  birthError.value = ''

  saving.value = true
  success.value = false
  errorMessage.value = ''

  const userData = {
    username: profileForm.username.trim(),
    first_name: profileForm.first_name.trim() || null,
    last_name: profileForm.last_name.trim() || null,
    email: profileForm.email.trim() || null,
    status: profileForm.status.trim() || null
  }

  const profileData = {
    bio: profileForm.bio.trim() || null,
    birth_date: dateToIso(profileForm.birth_date) || null,
    language: profileForm.language || null,
    country: profileForm.country || null,
    notifications_enabled: profileForm.notifications_enabled,
    privacy_mode: profileForm.privacy_mode,
    notification_preview: profileForm.notification_preview
  }

  try {
    await authStore.updateCurrentUser({ ...userData, profile: profileData })
    await authStore.fetchUser()
    success.value = true
  } catch (error) {
    errorMessage.value = getErrorMessage(error, t('Не удалось сохранить профиль'))
  } finally {
    saving.value = false
  }
}

// ---------- Тихие часы (не беспокоить) ----------
// Настройка серверная: push в Android-приложении рисует SDK RuStore, в PWA —
// служба push браузера, и при закрытом приложении наша страница решить «сейчас
// тихо» не может. Поэтому сервер сверяется с этими полями перед отправкой.
// Сохраняем сразу при изменении: отдельной кнопки тут нет (как у приватности).
const TIME_OPTIONS = timeOptions()
const quietSaving = ref(false)
const quietError = ref('')

const quietSummary = computed(() =>
  quietHoursSummary({
    enabled: profileForm.quiet_hours_enabled,
    start: profileForm.quiet_hours_start,
    end: profileForm.quiet_hours_end,
    allowCalls: profileForm.quiet_hours_allow_calls
  })
)

const saveQuietHours = async () => {
  if (quietSaving.value) return
  quietSaving.value = true
  quietError.value = ''
  try {
    await authStore.updateCurrentUser({
      profile: {
        quiet_hours_enabled: profileForm.quiet_hours_enabled,
        quiet_hours_start: profileForm.quiet_hours_start,
        quiet_hours_end: profileForm.quiet_hours_end,
        quiet_hours_allow_calls: profileForm.quiet_hours_allow_calls,
        // Сдвиг пояса спрашиваем у устройства в момент сохранения: после
        // переезда или перехода на летнее время он не устареет.
        quiet_hours_offset: localUtcOffsetMinutes()
      }
    })
    profileForm.quiet_hours_offset = localUtcOffsetMinutes()
  } catch (error) {
    quietError.value = getErrorMessage(error, t('Не удалось сохранить тихие часы'))
  } finally {
    quietSaving.value = false
  }
}

// ---------- Уведомления: тумблер профиля управляет push-подпиской ----------
// В браузере это Web Push (разрешение браузера + подписка), в Android-приложении
// из RuStore — RuStore Push (разрешение Android + push-токен RuStore). Вызов идёт
// из клика по тумблеру = жест пользователя (обязателен на мобильных).
const onNotificationsToggle = async (val: boolean) => {
  if (val) {
    if (isNativeApp()) {
      enableNativePush()
      errorMessage.value = ''
      return
    }
    const res = await enablePushNotifications()
    if (res !== 'granted') {
      profileForm.notifications_enabled = false
      errorMessage.value =
        res === 'denied'
          ? t(
              'Уведомления заблокированы браузером. Разрешите их в настройках сайта и попробуйте снова.'
            )
          : res === 'unsupported'
            ? t('Push-уведомления недоступны: нужен HTTPS или localhost.')
            : t('Не удалось включить push-уведомления.')
    } else {
      errorMessage.value = ''
    }
  } else {
    errorMessage.value = ''
    if (isNativeApp()) {
      await disableNativePush()
      return
    }
    await disablePushNotifications()
  }
}
</script>

<template>
  <div class="profile-sheet">
    <div v-if="!authStore.current_user" class="loading-block">
      <span class="spinner"></span>
      <p>{{ t('Загрузка профиля…') }}</p>
    </div>

    <template v-else>
      <!-- Шапка раздела (стрелка назад + название) — СВЕРХУ, до содержимого:
           заголовок служебного экрана стоял ниже списка, и «Администрирование»
           читалось как подпись к списку, а не как заголовок экрана
           (жалоба владельца). -->
      <div v-if="section !== 'root'" class="settings-head">
        <button
          type="button"
          class="settings-back"
          :title="t('К разделам')"
          @click="backToSections"
        >
          <q-icon :name="icon('arrow_back')" size="22px" />
        </button>
        <h2 class="settings-head-title">{{ currentSectionTitle }}</h2>
      </div>

      <!-- Главный экран: карточка профиля -->
      <div v-if="section === 'root'" class="profile-hero">
        <div class="avatar-box">
          <button
            type="button"
            class="hero-avatar"
            :style="avatarStyle"
            :title="hasAvatar ? t('Изменить фото') : t('Загрузить фото')"
            :disabled="avatarUploading"
            @click="avatarInput?.click()"
          >
            <img
              v-if="avatarSrc"
              :src="avatarSrc"
              class="avatar-photo"
              :alt="t('Аватар')"
              decoding="async"
            />
            <template v-else>{{ heroInitials }}</template>
            <span class="avatar-camera"><q-icon :name="icon('photo_camera')" size="15px" /></span>
          </button>
          <button
            v-if="hasAvatar"
            type="button"
            class="avatar-remove"
            :title="t('Удалить фото')"
            :disabled="avatarUploading"
            @click.stop="removeAvatarClick"
          >
            <q-icon :name="icon('delete')" size="14px" />
          </button>
          <input
            ref="avatarInput"
            class="hidden-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            @change="onAvatarSelected"
          />
        </div>
        <div class="hero-info">
          <h2 class="hero-name">{{ heroName }}</h2>
          <p class="hero-username">@{{ profileForm.username || 'username' }}</p>
          <p v-if="profileForm.status && profileForm.status.trim()" class="hero-status">
            {{ profileForm.status.trim() }}
          </p>
          <p v-if="profileForm.phone_number" class="hero-phone">
            <q-icon :name="icon('call')" size="14px" /> {{ profileForm.phone_number }}
          </p>
          <p v-if="avatarUploading" class="avatar-status">
            <span class="mini-spinner"></span> {{ t('Загрузка фото…') }}
          </p>
          <p v-else-if="avatarError" class="avatar-status error">{{ avatarError }}</p>
        </div>
      </div>

      <!-- Главный экран настроек: сверху сразу разделы (поиск и список) -->
      <nav v-if="section === 'root'" class="settings-list" :aria-label="t('Разделы настроек')">
        <!-- Поиск по настройкам: разделов много, нужный искать долго -->
        <div class="settings-search">
          <q-icon :name="icon('search')" size="17px" class="settings-search-icon" />
          <input
            v-model="settingsQuery"
            class="settings-search-input"
            type="text"
            :placeholder="t('Найти настройку')"
            :aria-label="t('Поиск по настройкам')"
          />
          <button
            v-if="settingsQuery"
            type="button"
            class="settings-search-clear"
            :title="t('Очистить')"
            @click="settingsQuery = ''"
          >
            <q-icon :name="icon('close')" size="16px" />
          </button>
        </div>
        <p v-if="!visibleSettingsEntries.length" class="settings-empty">
          {{ t('Ничего не нашлось — попробуйте другое слово.') }}
        </p>
        <template v-for="row in visibleSettingsEntries" :key="row.key">
          <!-- Полоса отделяет служебный вход — так же, как перед «Выйти из
               аккаунта». Это отдельный элемент, а не рамка кнопки: рамка
               читалась частью пункта (владелец: «не бордер, а полосу»). -->
          <div v-if="row.key === 'admin'" class="settings-separator" aria-hidden="true"></div>
          <button
            type="button"
            class="settings-link"
            :class="{ 'settings-link--admin': row.key === 'admin' }"
            @click="openSection(row.key)"
          >
            <q-icon :name="icon(row.icon)" size="21px" class="settings-link-icon" />
            <span class="settings-link-text">
              <span class="settings-link-title">{{ row.title }}</span>
              <span class="settings-link-desc">{{ row.desc }}</span>
            </span>
            <q-icon :name="icon('chevron_right')" size="20px" class="settings-link-chevron" />
          </button>
        </template>
      </nav>

      <!-- Служебный экран: приглашения, жалобы, техработы. Вход — пункт
           «Администрирование» в списке настроек. -->
      <nav
        v-if="section === 'admin'"
        class="settings-list"
        :aria-label="t('Разделы администрирования')"
      >
        <button
          v-for="row in adminRows"
          :key="row.key"
          type="button"
          class="settings-link"
          @click="openAdminRow(row.key)"
        >
          <q-icon :name="icon(row.icon)" size="21px" class="settings-link-icon" />
          <span class="settings-link-text">
            <span class="settings-link-title">{{ row.title }}</span>
            <span class="settings-link-desc">{{ row.desc }}</span>
          </span>
          <q-icon :name="icon('chevron_right')" size="20px" class="settings-link-chevron" />
        </button>
      </nav>

      <!-- Низ главного экрана: выход и удаление аккаунта.
           Выход переехал сюда сверху: там он тёрся о поиск по настройкам, а по
           смыслу это завершающее действие экрана — как в Telegram, где «Выйти»
           стоит в самом низу настроек. На разделах не показываем. -->
      <div v-if="section === 'root'" class="delete-account-row">
        <button type="button" class="logout-btn" :disabled="saving" @click="doLogout">
          <q-icon :name="icon('logout')" size="17px" />
          {{ t('Выйти из аккаунта') }}
        </button>
        <button
          type="button"
          class="delete-account-btn"
          :disabled="saving"
          @click="showDeleteAccount = true"
        >
          <q-icon :name="icon('delete_forever')" size="17px" />
          {{ t('Удалить аккаунт') }}
        </button>
        <p class="delete-account-hint">
          {{ t('Аккаунт, переписка и вложения будут удалены безвозвратно.') }}
        </p>
      </div>

      <!-- Внешний вид: тема, акцент, пузыри, размер текста и обои -->
      <div v-if="section === 'appearance'" class="settings-embed">
        <AppearanceSettings />
      </div>

      <!-- Приглашения (только владелец сервиса): ссылки на регистрацию. -->
      <div v-if="section === 'invites'" class="settings-embed">
        <InvitesSettings />
      </div>

      <!-- Жалобы: очередь разбора и журнал модерации. Раздел, а не отдельное
           окно — «назад» возвращает к служебному списку (жалоба владельца:
           «из жалоб назад дороги нет»). -->
      <div v-if="section === 'reports'" class="settings-embed">
        <ModerationReportsSection />
      </div>

      <!-- Технические работы (только владелец сервиса): рубильник, который
           закрывает приложение всем, кроме администраторов. -->
      <div v-if="section === 'maintenance' && authStore.isOwner" class="settings-embed">
        <MaintenanceSettings />
      </div>

      <!-- Устройство: что умеет ИМЕННО этот браузер. Самые частые «не работает»
           про среду (WebView без распознавания, браузер редактора без моделей
           Chrome) — раздел отвечает на это без переписки и консоли. -->
      <div v-if="section === 'device'" class="settings-embed">
        <DeviceSettings />
      </div>

      <transition name="fade">
        <div v-if="success" class="notice success">
          <q-icon :name="icon('check_circle')" size="18px" /> {{ t('Профиль сохранён') }}
        </div>
      </transition>
      <transition name="fade">
        <div v-if="errorMessage" class="notice error">
          <q-icon :name="icon('error')" size="18px" /> {{ errorMessage }}
        </div>
      </transition>

      <form class="profile-form" @submit.prevent="updateProfile">
        <!-- Статус -->
        <section v-if="section === 'account'" class="card-section">
          <h3 class="section-title">{{ t('Статус') }}</h3>
          <div class="field">
            <label for="pf-status">{{ t('Ваш статус') }}</label>
            <input
              id="pf-status"
              v-model="profileForm.status"
              type="text"
              maxlength="140"
              :placeholder="t('Например: в работе 🚀')"
            />
            <p class="field-hint">{{ t('Показывается собеседнику в шапке личного чата.') }}</p>
          </div>
        </section>

        <!-- Основное -->
        <section v-if="section === 'account'" class="card-section">
          <h3 class="section-title">{{ t('О себе') }}</h3>
          <div class="field">
            <label for="pf-bio">{{ t('Биография') }}</label>
            <textarea
              id="pf-bio"
              v-model="profileForm.bio"
              rows="3"
              :placeholder="t('Расскажите немного о себе…')"
            ></textarea>
          </div>
        </section>

        <!-- Имя -->
        <section v-if="section === 'account'" class="card-section">
          <h3 class="section-title">{{ t('Имя и фамилия') }}</h3>
          <div class="grid-2">
            <div class="field">
              <label for="pf-first">{{ t('Имя') }}</label>
              <input
                id="pf-first"
                v-model="profileForm.first_name"
                type="text"
                :placeholder="t('Имя')"
              />
            </div>
            <div class="field">
              <label for="pf-last">{{ t('Фамилия') }}</label>
              <input
                id="pf-last"
                v-model="profileForm.last_name"
                type="text"
                :placeholder="t('Фамилия')"
              />
            </div>
            <div class="field">
              <label for="pf-username">{{ t('Логин') }}</label>
              <input
                id="pf-username"
                v-model="profileForm.username"
                type="text"
                :placeholder="t('Логин')"
              />
            </div>
            <div class="field">
              <label for="pf-email">Email</label>
              <input id="pf-email" v-model="profileForm.email" type="email" placeholder="Email" />
              <p class="field-hint">
                <template v-if="authStore.current_user?.email_verified">
                  <q-icon :name="icon('verified')" size="14px" />
                  {{ t('Подтверждён — можно входить по коду на e-mail.') }}
                </template>
                <template v-else-if="emailChannelAvailable">
                  {{
                    t(
                      'Не подтверждён: подтвердите адрес, иначе войти по нему и восстановить пароль не получится.'
                    )
                  }}
                </template>
                <template v-else>
                  {{ t('Не подтверждён (отправка писем на сервере выключена).') }}
                </template>
              </p>
            </div>
          </div>
        </section>

        <!-- Контакты и локализация -->
        <section v-if="section === 'account'" class="card-section">
          <h3 class="section-title">{{ t('Контакты и локализация') }}</h3>
          <div class="grid-2">
            <div class="field">
              <label for="pf-phone">{{ t('Телефон') }}</label>
              <input
                id="pf-phone"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                :value="phoneFieldValue"
                readonly
                aria-readonly="true"
                class="readonly-field"
              />
              <p class="field-hint">
                {{ t('Это логин аккаунта, изменить номер нельзя. Нужен другой — напишите на') }}
                nyuskov@gmail.com.
              </p>
            </div>
            <div class="field">
              <label for="pf-birth">{{ t('Дата рождения') }}</label>
              <!-- Маска ДД.ММ.ГГГГ вместо `<input type="date">`: календарь рисует
                   браузер, и в WebView он открывается системным окном далеко от
                   поля (жалоба 15.09.2026). -->
              <input
                id="pf-birth"
                type="text"
                inputmode="numeric"
                autocomplete="bday"
                placeholder="ДД.ММ.ГГГГ"
                maxlength="10"
                :value="profileForm.birth_date"
                :aria-invalid="birthError ? 'true' : undefined"
                :aria-describedby="birthError ? 'pf-birth-error' : undefined"
                @input="onBirthInput"
                @blur="onBirthBlur"
              />
              <p v-if="birthError" id="pf-birth-error" class="field-problem">
                {{ birthError }}
              </p>
            </div>
            <div class="field">
              <label for="pf-lang">{{ t('Язык') }}</label>
              <SelectField
                id="pf-lang"
                v-model="profileForm.language"
                :options="LANGUAGE_OPTIONS"
                :aria-label="t('Язык')"
              />
            </div>
            <div class="field">
              <label for="pf-country">{{ t('Страна') }}</label>
              <SelectField
                id="pf-country"
                v-model="profileForm.country"
                :options="COUNTRY_OPTIONS"
                searchable
                :aria-label="t('Страна')"
              />
            </div>
          </div>
        </section>

        <!-- Уведомления -->
        <section v-if="section === 'notifications'" class="card-section">
          <h3 class="section-title">{{ t('Уведомления') }}</h3>
          <div class="toggle-row">
            <div class="toggle-text">
              <span class="toggle-name">{{ t('Уведомления о сообщениях') }}</span>
              <span class="toggle-desc">{{
                t('Системные push-уведомления, когда приложение свёрнуто или закрыто')
              }}</span>
            </div>
            <q-toggle
              v-model="profileForm.notifications_enabled"
              color="primary"
              keep-color
              @update:model-value="onNotificationsToggle"
            />
          </div>

          <!-- Текст сообщения в уведомлении: выключают те, кто не хочет, чтобы
               переписку читали с экрана блокировки. -->
          <div class="toggle-row">
            <div class="toggle-text">
              <span class="toggle-name">{{ t('Показывать текст сообщения') }}</span>
              <span class="toggle-desc">
                {{ t('Если выключить — в уведомлении будет только имя отправителя') }}
              </span>
            </div>
            <q-toggle
              v-model="profileForm.notification_preview"
              color="primary"
              keep-color
              :disable="!profileForm.notifications_enabled"
              @update:model-value="onPreviewToggle"
            />
          </div>

          <!-- Звук в приложении: настройка устройства (как тип звонка), поэтому
               живёт в localStorage, а не в профиле на сервере. -->
          <div class="toggle-row">
            <div class="toggle-text">
              <span class="toggle-name">{{ t('Звук сообщений') }}</span>
              <span class="toggle-desc">
                {{ t('Короткий звук в приложении; на этом устройстве') }}
              </span>
            </div>
            <q-toggle
              v-model="messageSoundEnabled"
              color="primary"
              keep-color
              @update:model-value="onMessageSoundToggle"
            />
          </div>

          <!-- Тихие часы: окно, когда push не приходит. Звонки по умолчанию
               разрешены — ночью человека будит звонок, а не сообщение. -->
          <div class="toggle-row">
            <div class="toggle-text">
              <span class="toggle-name">{{ t('Тихие часы') }}</span>
              <span class="toggle-desc">
                {{ t('Не присылать уведомления о сообщениях в выбранное время') }}
              </span>
            </div>
            <q-toggle
              v-model="profileForm.quiet_hours_enabled"
              color="primary"
              keep-color
              :disable="!profileForm.notifications_enabled"
              @update:model-value="saveQuietHours"
            />
          </div>

          <div v-if="profileForm.quiet_hours_enabled" class="quiet-block">
            <div class="quiet-times">
              <div class="field">
                <label for="pf-quiet-from">{{ t('С') }}</label>
                <SelectField
                  id="pf-quiet-from"
                  v-model="profileForm.quiet_hours_start"
                  :options="TIME_OPTIONS"
                  :aria-label="t('Начало тихих часов')"
                  @update:model-value="saveQuietHours"
                />
              </div>
              <div class="field">
                <label for="pf-quiet-to">{{ t('До') }}</label>
                <SelectField
                  id="pf-quiet-to"
                  v-model="profileForm.quiet_hours_end"
                  :options="TIME_OPTIONS"
                  :aria-label="t('Конец тихих часов')"
                  @update:model-value="saveQuietHours"
                />
              </div>
            </div>

            <div class="toggle-row quiet-calls">
              <div class="toggle-text">
                <span class="toggle-name">{{ t('Разрешить звонки') }}</span>
                <span class="toggle-desc">{{
                  t('Входящий звонок разбудит даже в тихие часы')
                }}</span>
              </div>
              <q-toggle
                v-model="profileForm.quiet_hours_allow_calls"
                color="primary"
                keep-color
                @update:model-value="saveQuietHours"
              />
            </div>

            <p class="field-hint">{{ quietSummary }}</p>
            <p class="field-hint">
              {{
                t('Время местное, {offset} —', {
                  offset: formatOffset(profileForm.quiet_hours_offset)
                })
              }}
              <span v-if="quietSaving">{{ t('сохраняем…') }}</span>
              <span v-else>{{ t('сохраняется сразу') }}</span>
            </p>
            <p v-if="quietError" class="field-problem">{{ quietError }}</p>
          </div>
        </section>

        <!-- Приватность -->
        <section v-if="section === 'privacy'" class="card-section">
          <h3 class="section-title">{{ t('Приватность') }}</h3>
          <div class="toggle-row">
            <div class="toggle-text">
              <span class="toggle-name">{{ t('Приватный режим') }}</span>
              <span class="toggle-desc">{{ t('Скрывать профиль от посторонних в поиске') }}</span>
            </div>
            <q-toggle
              v-model="profileForm.privacy_mode"
              color="primary"
              keep-color
              @update:model-value="onPrivacyToggle"
            />
          </div>
          <p class="field-hint">{{ t('Изменение сохраняется сразу.') }}</p>
        </section>

        <!-- Хранилище: сколько медиа занимает аккаунт -->
        <section v-if="section === 'storage'" class="card-section">
          <h3 class="section-title">{{ t('Хранилище') }}</h3>
          <div v-if="storageInfo" class="storage-block">
            <div class="storage-line">
              <span class="storage-used">
                {{ formatBytes(storageInfo.used_bytes) }} {{ t('из') }}
                {{ formatBytes(storageInfo.quota_bytes) }}
              </span>
              <span class="storage-files">{{ storageInfo.files }} {{ t('файл(ов)') }}</span>
            </div>
            <div class="storage-bar" role="progressbar" :aria-valuenow="storageInfo.percent">
              <span
                class="storage-bar-fill"
                :class="{ warn: storageWarn }"
                :style="{ width: `${storageInfo.percent}%` }"
              ></span>
            </div>
            <p class="storage-hint" :class="{ warn: storageWarn }">
              <template v-if="storageWarn">
                <q-icon :name="icon('warning')" size="16px" />
                {{
                  t(
                    'Место почти закончилось: новые файлы не загрузятся — удалите старые сообщения с вложениями.'
                  )
                }}
              </template>
              <template v-else>
                {{
                  t(
                    'Пересланные файлы не тратят место второй раз. Освобождается сразу после удаления сообщения.'
                  )
                }}
              </template>
            </p>
            <button
              type="button"
              class="storage-refresh"
              :disabled="storageLoading"
              @click="loadStorage"
            >
              <q-icon :name="icon('refresh')" size="15px" /> {{ t('Обновить') }}
            </button>
          </div>
          <p v-else class="storage-hint">
            {{ storageLoading ? t('Загружаем…') : t('Не удалось получить данные хранилища.') }}
          </p>

          <!-- Кэш на устройстве: оболочка приложения (сам бандл, шрифты, иконки).
               Вложения кэширует браузер, поэтому их здесь нет. -->
          <div v-if="deviceCache?.supported" class="device-cache">
            <div class="storage-line">
              <span class="storage-used">{{ t('Кэш приложения на устройстве') }}</span>
              <span class="storage-files">{{ formatBytes(deviceCache.usage) }}</span>
            </div>
            <p class="storage-hint">
              {{
                t(
                  '{count} файл(ов) оболочки (страницы, шрифты, иконки). Переписка, черновики и настройки лежат отдельно и очисткой не затрагиваются.',
                  { count: deviceCache.entries }
                )
              }}
            </p>
            <button
              type="button"
              class="storage-refresh"
              :disabled="cacheClearing"
              @click="onClearAppCache"
            >
              <q-icon :name="icon('delete_outline')" size="15px" />
              {{ cacheClearing ? t('Очищаем…') : t('Очистить кэш приложения') }}
            </button>
            <p v-if="cacheNotice" class="storage-hint">{{ cacheNotice }}</p>
          </div>

          <!-- Поиск по зашифрованным чатам: индекс расшифрованного текста лежит
               только на устройстве (сервер в шифрованном чате текста не видит). -->
          <div class="device-cache">
            <div class="toggle-row">
              <div class="toggle-text">
                <span class="toggle-name">{{ t('Поиск по зашифрованным чатам') }}</span>
                <span class="toggle-desc">
                  {{
                    t(
                      'В шифрованном чате сервер текста не видит, поэтому поиск идёт по индексу на этом устройстве. Запоминается только текст сообщений, которые вы уже прочитали здесь; ключи шифрования в индексе не хранятся.'
                    )
                  }}
                </span>
              </div>
              <q-toggle
                v-model="localSearchOn"
                color="primary"
                keep-color
                @update:model-value="onToggleLocalSearch"
              />
            </div>
            <div class="storage-line">
              <span class="storage-used">{{ t('Индекс на устройстве') }}</span>
              <span class="storage-files"
                >{{ localSearchSize }}
                {{
                  plural(
                    localSearchSize,
                    ['сообщение', 'сообщения', 'сообщений'],
                    ['message', 'messages']
                  )
                }}</span
              >
            </div>
            <button
              type="button"
              class="storage-refresh"
              :disabled="localSearchSize === 0"
              @click="onClearLocalSearch"
            >
              <q-icon :name="icon('delete_outline')" size="15px" /> {{ t('Очистить индекс') }}
            </button>
            <p v-if="localSearchNotice" class="storage-hint">{{ localSearchNotice }}</p>
          </div>
        </section>

        <!-- Моя ссылка: по ней человек открывает чат с вами -->
        <section v-if="section === 'link'" class="card-section">
          <h3 class="section-title">{{ t('Моя ссылка') }}</h3>
          <template v-if="myProfileLink">
            <!-- QR-код — первым, как в Telegram: по нему дают ссылку без
                 пересылки (наводят камеру другого телефона). -->
            <div class="profile-link-qr">
              <QrCode
                :value="myProfileLink"
                :size="180"
                :label="t('QR-код ссылки на ваш профиль')"
              />
              <p class="profile-link-qr-hint">
                {{ t('Наводят камеру другого телефона — чат со мной откроется сразу.') }}
              </p>
            </div>
            <!-- Пояснение — под кодом, а не над ним: первым человек должен видеть
                 сам код, а не текст о нём. -->
            <p class="profile-link-hint">
              {{
                t(
                  'Дайте эту ссылку — по ней в Pismo откроется чат с вами. Номер телефона в ссылке не виден: логин уникален и служит только адресом профиля.'
                )
              }}
            </p>
            <div class="profile-link-row">
              <input
                class="profile-link-input"
                type="text"
                readonly
                :value="myProfileLink"
                :aria-label="t('Ссылка на профиль')"
              />
              <button type="button" class="btn ghost" @click="copyProfileLink">
                <q-icon :name="icon('content_copy')" size="17px" /> Копировать
              </button>
            </div>
            <p v-if="linkNotice" class="notice success">{{ linkNotice }}</p>
          </template>
          <p v-else class="profile-link-hint">
            {{ t('Логин не задан — ссылку пока не создать.') }}
          </p>
        </section>

        <!-- Безопасность: пароль и сессии -->
        <section v-if="section === 'security'" class="section security-section">
          <h3 class="section-title">{{ t('Безопасность') }}</h3>

          <div v-if="securityIssues.length" class="security-alert">
            <q-icon :name="icon('shield')" size="18px" />
            <div>
              <strong>{{ t('Аккаунт стоит защитить') }}</strong>
              <ul>
                <li v-for="issue in securityIssues" :key="issue">{{ issue }}</li>
              </ul>
            </div>
          </div>

          <p class="security-hint">
            {{
              t(
                'Вход — по номеру телефона. Пароль нужен, чтобы входить без кода в Telegram; минимум {count} символов, лучше — длинная фраза.',
                { count: PASSWORD_MIN_LENGTH }
              )
            }}
          </p>

          <!-- Подтверждение e-mail: код из письма (канал входа и сброса пароля) -->
          <div v-if="emailChannelAvailable" class="email-verify">
            <div class="email-verify-text">
              <strong>
                {{
                  authStore.current_user?.email_verified
                    ? t('E-mail подтверждён')
                    : t('Подтверждение e-mail')
                }}
              </strong>
              <span>
                {{
                  authStore.current_user?.email_verified
                    ? t('По нему можно войти без пароля и восстановить доступ.')
                    : t('Без подтверждения адрес не годится для входа и восстановления пароля.')
                }}
              </span>
            </div>

            <template v-if="!authStore.current_user?.email_verified">
              <div class="email-verify-actions">
                <button
                  type="button"
                  class="revoke-btn"
                  :disabled="emailBusy"
                  @click="sendEmailCode"
                >
                  <q-icon :name="icon('forward_to_inbox')" size="17px" />
                  {{ emailCodeSent ? t('Отправить код ещё раз') : t('Отправить код на e-mail') }}
                </button>

                <div v-if="emailCodeSent" class="email-code-row">
                  <input
                    v-model="emailCodeInput"
                    inputmode="numeric"
                    maxlength="6"
                    :placeholder="t('Код из письма')"
                    :aria-label="t('Код из письма')"
                    @keyup.enter="confirmEmailCode"
                  />
                  <button
                    type="button"
                    class="security-btn"
                    :disabled="emailBusy"
                    @click="confirmEmailCode"
                  >
                    {{ t('Подтвердить') }}
                  </button>
                </div>
              </div>
            </template>

            <transition name="fade">
              <p v-if="emailNotice" class="email-note">{{ emailNotice }}</p>
            </transition>
            <transition name="fade">
              <p v-if="emailError" class="email-error">{{ emailError }}</p>
            </transition>
          </div>

          <form class="security-form" @submit.prevent="changePassword">
            <label v-if="authStore.current_user?.password_set" class="field-label" for="pf-current">
              {{ t('Текущий пароль') }}
            </label>
            <div v-if="authStore.current_user?.password_set" class="password-wrap">
              <input
                id="pf-current"
                v-model="passwordForm.current"
                :type="passwordVisible.current ? 'text' : 'password'"
                autocomplete="current-password"
                :placeholder="t('Текущий пароль')"
              />
              <button
                type="button"
                class="password-eye"
                :aria-label="passwordVisible.current ? t('Скрыть пароль') : t('Показать пароль')"
                @click="passwordVisible.current = !passwordVisible.current"
              >
                <q-icon
                  :name="icon(passwordVisible.current ? 'visibility_off' : 'visibility')"
                  size="18px"
                />
              </button>
            </div>

            <label class="field-label" for="pf-new">{{ t('Новый пароль') }}</label>
            <div class="password-wrap">
              <input
                id="pf-new"
                v-model="passwordForm.next"
                :type="passwordVisible.next ? 'text' : 'password'"
                autocomplete="new-password"
                :placeholder="t('Новый пароль')"
              />
              <button
                type="button"
                class="password-eye"
                :aria-label="passwordVisible.next ? t('Скрыть пароль') : t('Показать пароль')"
                @click="passwordVisible.next = !passwordVisible.next"
              >
                <q-icon
                  :name="icon(passwordVisible.next ? 'visibility_off' : 'visibility')"
                  size="18px"
                />
              </button>
            </div>
            <p v-if="passwordForm.next" class="password-meter" :data-score="passwordScore.score">
              <span class="password-meter-bar"
                ><span :style="{ width: `${passwordScore.score * 33}%` }"
              /></span>
              {{ passwordScore.label
              }}<template v-if="passwordHint"> — {{ passwordHint }}</template>
            </p>

            <label class="field-label" for="pf-confirm">{{ t('Повторите пароль') }}</label>
            <div class="password-wrap">
              <input
                id="pf-confirm"
                v-model="passwordForm.confirm"
                :type="passwordVisible.confirm ? 'text' : 'password'"
                autocomplete="new-password"
                :placeholder="t('Повторите пароль')"
              />
              <button
                type="button"
                class="password-eye"
                :aria-label="passwordVisible.confirm ? t('Скрыть пароль') : t('Показать пароль')"
                @click="passwordVisible.confirm = !passwordVisible.confirm"
              >
                <q-icon
                  :name="icon(passwordVisible.confirm ? 'visibility_off' : 'visibility')"
                  size="18px"
                />
              </button>
            </div>

            <button type="submit" class="security-btn" :disabled="passwordSaving">
              <q-icon
                :name="icon(authStore.current_user?.password_set ? 'lock_reset' : 'lock')"
                size="17px"
              />
              {{
                passwordSaving
                  ? t('Сохранение…')
                  : authStore.current_user?.password_set
                    ? t('Сменить пароль')
                    : t('Задать пароль')
              }}
            </button>

            <p class="security-note">
              {{ t('После смены пароля все другие устройства выйдут из аккаунта.') }}
            </p>
          </form>

          <transition name="fade">
            <div v-if="passwordNotice" class="notice success">
              <q-icon :name="icon('check_circle')" size="18px" /> {{ passwordNotice }}
            </div>
          </transition>
          <transition name="fade">
            <div v-if="passwordError" class="notice error">
              <q-icon :name="icon('error')" size="18px" /> {{ passwordError }}
            </div>
          </transition>

          <button
            type="button"
            class="revoke-btn"
            :disabled="passwordSaving"
            @click="doRevokeAllSessions"
          >
            <q-icon :name="icon('phonelink_erase')" size="17px" />
            {{ t('Выйти на всех устройствах') }}
          </button>

          <!-- Активные входы: видно, где ещё открыт аккаунт -->
          <div class="sessions-block">
            <div class="sessions-head">
              <span class="sessions-title">{{ t('Активные входы') }}</span>
              <button
                type="button"
                class="sessions-refresh"
                :disabled="sessionsLoading"
                @click="loadSessions"
              >
                <q-icon :name="icon('refresh')" size="16px" />
                {{ t('Обновить') }}
              </button>
            </div>

            <p v-if="sessionsLoading && !sessions.length" class="sessions-hint">
              {{ t('Загружаем устройства…') }}
            </p>
            <p v-else-if="!sessions.length && !sessionsError" class="sessions-hint">
              {{ t('Активных входов не найдено.') }}
            </p>

            <ul class="sessions-list">
              <li v-for="row in sessions" :key="row.id" class="session-row">
                <span class="session-icon">
                  <q-icon :name="icon(row.current ? 'computer' : 'devices')" size="18px" />
                </span>
                <span class="session-info">
                  <span class="session-device">
                    {{ deviceLabel(row.device) }}
                    <span v-if="row.current" class="session-current">{{
                      t('это устройство')
                    }}</span>
                  </span>
                  <span class="session-meta">
                    <template v-if="platformLabel(row.device)">
                      {{ platformLabel(row.device) }} ·
                    </template>
                    {{ sessionTime(row.created_at) }}
                    <template v-if="row.ip"> · IP {{ row.ip }}</template>
                  </span>
                </span>
                <button
                  type="button"
                  class="session-revoke"
                  :disabled="sessionsLoading"
                  :title="row.current ? t('Выйти на этом устройстве') : t('Завершить этот вход')"
                  @click="revokeSessionRow(row)"
                >
                  {{ row.current ? t('Выйти') : t('Завершить') }}
                </button>
              </li>
            </ul>

            <transition name="fade">
              <p v-if="sessionsNotice" class="sessions-note success-text">
                <q-icon :name="icon('check_circle')" size="16px" /> {{ sessionsNotice }}
              </p>
            </transition>
            <transition name="fade">
              <p v-if="sessionsError" class="sessions-note error-text">
                <q-icon :name="icon('error')" size="16px" /> {{ sessionsError }}
              </p>
            </transition>

            <p class="security-note">
              {{
                t(
                  'Вход с нового устройства требует код из письма, а о каждом таком входе мы сообщаем на подтверждённый e-mail.'
                )
              }}
            </p>

            <!-- Стоп-кран на случай угона: закрываем вход всем до подтверждения почты -->
            <div class="freeze-block">
              <div class="freeze-info">
                <span class="freeze-title">{{ t('Заморозить аккаунт') }}</span>
                <span class="freeze-desc">
                  {{
                    t(
                      'Если в аккаунт вошли чужие: все устройства выйдут, вход будет закрыт. Разморозить можно кодом на подтверждённый e-mail.'
                    )
                  }}
                </span>
              </div>
              <button type="button" class="freeze-btn" :disabled="freezeBusy" @click="startFreeze">
                {{ freezeBusy ? t('Заморозка…') : t('Заморозить') }}
              </button>
            </div>
            <transition name="fade">
              <p v-if="freezeError" class="sessions-note error-text">
                <q-icon :name="icon('error')" size="16px" /> {{ freezeError }}
              </p>
            </transition>
          </div>

          <!-- История событий аккаунта: ответ на «что происходило с аккаунтом» -->
          <div class="security-log">
            <div class="sessions-head">
              <span class="sessions-title">{{ t('Последние действия') }}</span>
              <button
                type="button"
                class="sessions-refresh"
                :disabled="securityLogLoading"
                @click="loadSecurityLog"
              >
                <q-icon :name="icon('refresh')" size="16px" />
                {{ t('Обновить') }}
              </button>
            </div>

            <p v-if="securityLogLoading && !securityLog.length" class="sessions-hint">
              {{ t('Загружаем историю…') }}
            </p>
            <p v-else-if="!securityLog.length && !securityLogError" class="sessions-hint">
              {{ t('Событий пока нет.') }}
            </p>

            <ul class="sessions-list">
              <li
                v-for="entry in securityLog"
                :key="entry.id"
                class="session-row"
                :class="{ 'session-alert': isAlertEvent(entry.event) }"
              >
                <span class="session-icon">
                  <q-icon :name="icon(isAlertEvent(entry.event) ? 'shield' : 'info')" size="18px" />
                </span>
                <span class="session-info">
                  <span class="session-device">{{ entry.title }}</span>
                  <span class="session-meta">
                    {{ formatEventTime(entry.created_at) }}
                    <template v-if="deviceLabelOf(entry.device)">
                      · {{ deviceLabelOf(entry.device) }}
                    </template>
                    <template v-if="entry.ip"> · IP {{ entry.ip }}</template>
                    <template v-if="entry.detail"> · {{ entry.detail }}</template>
                  </span>
                </span>
              </li>
            </ul>

            <p v-if="securityLogError" class="sessions-note error-text">
              <q-icon :name="icon('error')" size="16px" /> {{ securityLogError }}
            </p>

            <p class="security-note">
              История хранится 180 дней и видна только вам. Если увидели незнакомый вход — смените
              пароль и нажмите «Выйти на всех устройствах».
            </p>
          </div>

          <!-- Резервная копия ключа шифрования: ключ живёт только в этом браузере -->
          <div class="sessions-block">
            <div class="sessions-head">
              <span class="sessions-title">Ключ шифрования</span>
              <button type="button" class="sessions-refresh" @click="showE2eeBackup = true">
                <q-icon :name="icon('lock_reset')" size="16px" />
                Резервная копия
              </button>
            </div>
            <p class="sessions-hint">
              Ключ сквозного шифрования хранится только в этом браузере: переустановка приложения
              или потеря телефона уносят с собой переписку зашифрованных чатов. Сохраните копию
              ключа — она вернёт доступ на новом устройстве.
            </p>
          </div>
        </section>

        <!-- Сообщения -->
        <!-- О приложении: документы, версия сборки, проверка обновлений -->
        <section v-if="section === 'about'" class="card-section">
          <h3 class="section-title">О приложении</h3>

          <!-- Документы: правила сообщества и политика (требования магазинов к UGC) -->
          <div class="legal-row">
            <a class="legal-link" href="/community.html" target="_blank" rel="noopener">
              <q-icon :name="icon('gavel')" size="16px" />
              Правила сообщества
            </a>
            <a class="legal-link" href="/privacy.html" target="_blank" rel="noopener">
              <q-icon :name="icon('privacy_tip')" size="16px" />
              Политика конфиденциальности
            </a>
            <a class="legal-link" href="/terms.html" target="_blank" rel="noopener">
              <q-icon :name="icon('description')" size="16px" />
              Пользовательское соглашение
            </a>
          </div>

          <p class="about-build">
            Pismo · сборка {{ buildInfo.commit || 'локальная' }} от {{ buildInfo.date }}
          </p>

          <button
            type="button"
            class="btn ghost about-update"
            :disabled="updatingApp"
            @click="checkForUpdates"
          >
            <q-icon :name="icon('refresh')" size="17px" />
            {{ updatingApp ? 'Проверяем…' : 'Проверить обновления' }}
          </button>
          <transition name="fade">
            <p v-if="aboutNotice" class="field-hint about-notice">{{ aboutNotice }}</p>
          </transition>
        </section>

        <div v-if="section === 'account'" class="form-actions">
          <button type="button" class="btn ghost" :disabled="saving" @click="closeModal">
            Отмена
          </button>
          <button type="submit" class="btn primary" :disabled="saving">
            <span v-if="saving" class="spinner light"></span>
            <q-icon v-else :name="icon('check')" size="17px" />
            {{ saving ? 'Сохранение…' : 'Сохранить' }}
          </button>
        </div>
      </form>
    </template>

    <!-- Диалог удаления аккаунта (требование RuStore/152-ФЗ) -->
    <DeleteAccountDialog
      v-if="showDeleteAccount"
      @close="showDeleteAccount = false"
      @deleted="onAccountDeleted"
    />

    <!-- Резервная копия ключа шифрования (F2) -->
    <E2eeBackupDialog
      v-if="showE2eeBackup"
      :my-user-id="authStore.current_user?.id ?? null"
      @close="showE2eeBackup = false"
    />
  </div>
</template>

<style scoped>
.profile-sheet {
  color: var(--ms-text);
  font-family: var(--ms-font);
}

.loading-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--ms-muted);
}

/* Шапка */
/* ---------- Список разделов настроек ---------- */
/* Поиск по настройкам. */
.settings-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  padding: 9px 12px;
  border: 1px solid var(--ms-border);
  border-radius: 12px;
  background: var(--ms-surface-2);
}

.settings-search-icon {
  color: var(--ms-muted-3);
}

.settings-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--ms-text);
  font: inherit;
  font-size: 14px;
}

.settings-search-input:focus {
  outline: none;
}

.settings-search-clear {
  display: inline-flex;
  padding: 2px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ms-muted);
  cursor: pointer;
}

.settings-empty {
  margin: 4px 0 10px;
  font-size: 13px;
  color: var(--ms-muted);
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* Отступ от «Выйти из аккаунта» (и шапки раздела): при 4px кнопка упиралась
     в поле поиска вплотную. */
  margin-top: var(--ms-space-3);
}

.settings-link {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 13px 12px;
  border: none;
  border-radius: var(--ms-radius, 12px);
  background: transparent;
  color: var(--ms-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.settings-link:hover {
  background: var(--ms-hover);
}

.settings-link-icon {
  color: var(--ms-icon);
}

.settings-link-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settings-link-title {
  font-weight: 600;
}

.settings-link-desc {
  font-size: 12.5px;
  color: var(--ms-muted);
}

.settings-link-chevron {
  margin-left: auto;
  color: var(--ms-muted-3);
}

/* Полоса над служебным входом.

   Ровно тот же приём, что у `.delete-account-row`: воздух сверху, штриховая
   полоса во всю ширину списка, воздух снизу. Не рамка кнопки — иначе линия
   читалась частью пункта и липла к его содержимому (владелец: «не бордер, а
   как здесь просто полоса сверху»). */
.settings-separator {
  margin: var(--ms-space-3) 0;
  border-top: 1px dashed var(--ms-border);
}

/* Служебный вход — обычная строка настроек, отличается только цветом иконки. */
.settings-link--admin .settings-link-icon {
  color: var(--ms-accent);
}

/* Шапка раздела: назад + название */
.settings-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 10px;
}

.settings-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ms-icon);
  cursor: pointer;
}

.settings-back:hover {
  background: var(--ms-hover);
}

.settings-head-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ms-text-strong);
}

.about-build {
  margin: 10px 0 var(--ms-space-3);
  font-size: 12.5px;
  color: var(--ms-muted);
}

/* Встроенный раздел (оформление): минимум лишних отступов */
.settings-embed {
  padding: 2px 4px 8px;
}

.about-update {
  width: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* Результат проверки («Обновлений нет…») — с отступом от кнопки: без него
   строка липла к ней вплотную (`field-hint` — с нулевым отступом, и он
   объявлен НИЖЕ по файлу, поэтому нужен селектор посильнее одиночного класса). */
p.about-notice.field-hint {
  margin-top: var(--ms-space-3);
}

.profile-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 4px 2px 22px;
  border-bottom: 1px solid var(--ms-border);
  margin-bottom: 18px;
}

.hero-avatar {
  width: 84px;
  height: 84px;
  border-radius: 28px;
  color: var(--ms-on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.9rem;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: var(--ms-shadow-md);
  border: none;
  cursor: pointer;
  overflow: hidden;
  position: relative;
  padding: 0;
  transition:
    box-shadow 0.2s,
    filter 0.2s;
}

.hero-avatar:hover:not(:disabled) {
  filter: brightness(1.04);
  box-shadow: var(--ms-shadow-md);
}

.hero-avatar:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.avatar-box {
  position: relative;
  flex-shrink: 0;
}

.avatar-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar-camera {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--ms-backdrop);
  color: var(--ms-on-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  pointer-events: none;
}

/* Удаление фото: раньше это был красный крестик В ЛЕВОМ ВЕРХНЕМ углу аватара —
   он читался как «ошибка» на снимке. Теперь это нейтральная кнопка в углу,
   зеркально камере (та — справа внизу), с той же поверхностной подложкой. */
.avatar-remove {
  position: absolute;
  left: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: var(--ms-backdrop);
  color: var(--ms-on-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  cursor: pointer;
  padding: 0;
  transition:
    transform 0.12s,
    background 0.2s;
}

.avatar-remove:hover:not(:disabled) {
  transform: scale(1.1);
  background: var(--ms-danger);
}

.avatar-remove:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hidden-file {
  display: none;
}

.avatar-status {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ms-accent);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.avatar-status.error {
  color: var(--ms-danger);
}

.mini-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--ms-accent-border);
  border-top-color: var(--ms-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.hero-info {
  min-width: 0;
}

.hero-name {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
  color: var(--ms-text-strong);
}

.hero-username {
  margin: 0 0 4px;
  color: var(--ms-muted);
  font-size: 14px;
}

.hero-status {
  margin: 0 0 4px;
  color: var(--ms-accent);
  font-size: 13.5px;
  font-weight: 500;
  word-break: break-word;
}

.hero-phone {
  margin: 0;
  font-size: 13.5px;
  color: var(--ms-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hero-phone i {
  font-size: 0.85rem;
}

/* Секции-карточки */
.profile-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-section {
  background: var(--ms-surface-2);
  border: 1px solid var(--ms-border);
  border-radius: 16px;
  padding: 16px 18px;
}

.section-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ms-muted-2);
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ms-icon);
}

.field-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ms-muted-2);
}

/* Телефон — только для чтения: номер является логином аккаунта. */
.readonly-field {
  background: var(--ms-surface-2) !important;
  color: var(--ms-icon) !important;
  cursor: not-allowed;
}

.readonly-field:focus {
  border-color: var(--ms-border);
  box-shadow: none;
}

.field input,
.field textarea,
.field select {
  width: 100%;
  box-sizing: border-box;
  border: 1.5px solid var(--ms-border);
  border-radius: 11px;
  padding: 10px 12px;
  font-size: 14.5px;
  color: var(--ms-text-strong);
  background: var(--ms-surface);
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  font-family: inherit;
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  border-color: var(--ms-accent, var(--ms-accent));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 15%, transparent);
}

.field textarea {
  resize: vertical;
  min-height: 70px;
}

.field select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238295a3' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

/* Тумблеры */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 2px;
}

/* Тихие часы: окно настройки раскрывается под тумблером */
.quiet-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 2px 2px;
}

.quiet-times {
  display: flex;
  gap: 12px;
}

.quiet-times .field {
  flex: 1;
  min-width: 0;
}

/* Тумблер звонков внутри блока: разделитель сверху не нужен */
.quiet-calls {
  padding-top: 6px;
}

.toggle-row + .toggle-row {
  border-top: 1px solid var(--ms-border);
}

.toggle-text {
  display: flex;
  flex-direction: column;
}

.toggle-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ms-text);
}

.toggle-desc {
  font-size: 12.5px;
  color: var(--ms-muted-2);
  margin-top: 2px;
}

/* Кнопки и уведомления */

/* Безопасность: пароль и сессии.
   Секция — колонка: раньше `gap` здесь ничего не делал (у блока нет `display:
   flex`), и предупреждение, подсказка, форма пароля и кнопка выхода стояли
   вплотную друг к другу. */
.security-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Заголовок в колонке: свой `margin-bottom` (12px) складывался с gap секции */
.security-section > .section-title {
  margin-bottom: 0;
}

.security-alert {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--ms-warn-bg);
  border-radius: 12px;
  background: var(--ms-warn-bg);
  color: var(--ms-warn);
  font-size: 13.5px;
}

.security-alert strong {
  display: block;
  margin-bottom: 4px;
  color: var(--ms-warn);
}

.security-alert ul {
  margin: 0;
  padding-left: 18px;
}

.security-hint {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted);
}

.security-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Поля формы пароля: подпись в 6px от своего поля, а между полями — 12px
   (иначе «Новый пароль» прилипал к предыдущему полю). */
.security-form .field-label:not(:first-child) {
  margin-top: 6px;
}

.security-form input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ms-border);
  border-radius: 11px;
  background: var(--ms-surface);
  font: inherit;
  font-size: 14.5px;
  color: var(--ms-text);
}

.security-form input:focus {
  outline: none;
  border-color: var(--ms-accent, var(--ms-accent));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 15%, transparent);
}

.password-meter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 2px;
  font-size: 12.5px;
  color: var(--ms-muted);
}

.password-meter-bar {
  display: inline-block;
  width: 90px;
  height: 5px;
  border-radius: 999px;
  background: var(--ms-border);
  overflow: hidden;
}

.password-meter-bar > span {
  display: block;
  height: 100%;
  background: var(--ms-warn);
  transition: width 0.2s ease;
}

.password-meter[data-score='3'] .password-meter-bar > span {
  background: var(--ms-accent);
}

.security-btn,
.revoke-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 11px;
  font: inherit;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
}

.security-btn {
  align-self: flex-start;
  margin-top: 8px;
  border: none;
  background: var(--ms-accent, var(--ms-accent));
  color: var(--ms-on-accent);
}

.revoke-btn {
  align-self: flex-start;
  margin-top: 4px;
  border: 1px solid var(--ms-border);
  background: var(--ms-surface);
  color: var(--ms-text);
}

.security-btn:disabled,
.revoke-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.security-note {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--ms-muted-2);
}

/* Хранилище: индикатор заполненности квоты на медиа. */
.storage-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.storage-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.storage-used {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text);
}

.storage-files {
  font-size: 12.5px;
  color: var(--ms-muted-2);
}

.storage-bar {
  height: 8px;
  border-radius: 999px;
  background: var(--ms-surface-2);
  overflow: hidden;
}

.storage-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--ms-accent, var(--ms-accent));
  transition: width 0.3s ease;
}

.storage-bar-fill.warn {
  background: var(--ms-warn);
}

.storage-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12.5px;
  color: var(--ms-muted-2);
}

.storage-hint.warn {
  color: var(--ms-warn);
}

/* Кэш приложения на устройстве: отдельный блок под лимитом аккаунта */
.device-cache {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--ms-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.storage-refresh {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--ms-accent, var(--ms-accent));
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 0;
}

.storage-refresh:disabled {
  opacity: 0.55;
  cursor: default;
}

/* История событий аккаунта: строки с иконкой щита у «важных» событий. */
.security-log {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--ms-surface-2);
}

.session-row.session-alert .session-icon {
  background: var(--ms-warn-bg);
  color: var(--ms-warn);
}

/* Активные входы (устройства) — список с отзывом по одному. */
.sessions-block {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--ms-surface-2);
}

.sessions-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sessions-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text);
}

.sessions-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--ms-accent, var(--ms-accent));
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 8px;
}

.sessions-refresh:disabled {
  opacity: 0.55;
  cursor: default;
}

.sessions-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--ms-muted-2);
}

.sessions-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--ms-surface-2);
  border-radius: 12px;
  background: var(--ms-surface-2);
}

.session-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 12%, transparent);
  color: var(--ms-accent, var(--ms-accent));
  flex-shrink: 0;
}

.session-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.session-device {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-current {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 14%, transparent);
  color: var(--ms-accent, var(--ms-accent));
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  flex-shrink: 0;
}

.session-meta {
  font-size: 12px;
  color: var(--ms-muted-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-revoke {
  flex-shrink: 0;
  border: 1px solid var(--ms-border);
  background: var(--ms-surface);
  color: var(--ms-danger);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 9px;
  cursor: pointer;
}

.session-revoke:hover {
  border-color: var(--ms-danger);
  background: var(--ms-danger-bg);
}

.session-revoke:disabled {
  opacity: 0.55;
  cursor: default;
}

.sessions-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  font-size: 13px;
}

.sessions-note.success-text {
  color: var(--ms-accent);
}

.sessions-note.error-text {
  color: var(--ms-danger);
}

/* Заморозка аккаунта: заметный, но не «кричащий» блок в разделе «Безопасность» */
.freeze-block {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: 12px;
  background: var(--ms-surface-2, #f6f8f9);
}

.freeze-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.freeze-title {
  font-weight: 600;
  color: var(--ms-text-strong, #1d2733);
}

.freeze-desc {
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--ms-muted, #93a0ab);
}

.freeze-btn {
  flex-shrink: 0;
  border: 1px solid var(--ms-danger, #c0392b);
  background: transparent;
  color: var(--ms-danger, #c0392b);
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.freeze-btn:hover:not(:disabled) {
  background: var(--ms-danger-bg, #fdecea);
}

.freeze-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

/* Подтверждение e-mail в разделе «Безопасность». */
.email-verify {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--ms-border);
  border-radius: 12px;
  background: var(--ms-surface-2);
}

.email-verify-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13.5px;
  color: var(--ms-text);
}

.email-verify-text span {
  font-size: 12.5px;
  color: var(--ms-muted);
}

.email-verify-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.email-code-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.email-code-row input {
  flex: 1;
  min-width: 120px;
  padding: 9px 12px;
  border: 1px solid var(--ms-border);
  border-radius: 11px;
  background: var(--ms-surface);
  font: inherit;
  font-size: 14.5px;
  color: var(--ms-text);
}

.email-code-row input:focus {
  outline: none;
  border-color: var(--ms-accent, var(--ms-accent));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 15%, transparent);
}

.email-note {
  margin: 0;
  font-size: 12.5px;
  color: var(--ms-accent);
}

.email-error {
  margin: 0;
  font-size: 12.5px;
  color: var(--ms-danger);
}

.field-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ms-muted-2);
}

/* Ошибка под полем (дата рождения): тот же ритм, что у подсказки, но цветом
   опасности — рядом с полем, а не общей плашкой внизу формы. */
.field-problem {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ms-danger);
}

/* Поле пароля с «глазком»: кнопка лежит поверх инпута справа. */
.password-wrap {
  position: relative;
  display: flex;
}

.password-wrap input {
  padding-right: 42px;
}

.password-eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--ms-muted-2);
  cursor: pointer;
}

.password-eye:hover {
  background: var(--ms-hover);
  color: var(--ms-text);
}

/* Выход и удаление аккаунта — низ главного экрана (требование RuStore/152-ФЗ
   для удаления): выход нейтральный, красный цвет — только у удаления. */
.delete-account-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--ms-border);
}

/* Ссылки на документы: правила сообщества и политика (требования магазинов). */
.legal-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 12px;
}

.legal-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ms-accent, var(--ms-accent));
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.legal-link:hover {
  text-decoration: underline;
}

.delete-account-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid var(--ms-danger-bg);
  border-radius: 11px;
  background: var(--ms-danger-bg);
  color: var(--ms-danger);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.delete-account-btn:hover:not(:disabled) {
  background: var(--ms-danger-bg);
}

.delete-account-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.delete-account-hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--ms-muted-2);
}

.logout-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--ms-surface-2);
  color: var(--ms-text);
  border: 1px solid var(--ms-border);
  border-radius: 11px;
  padding: 10px 14px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.logout-btn:hover:not(:disabled) {
  background: var(--ms-hover);
}

.logout-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 6px;
}

.btn {
  border: none;
  border-radius: 12px;
  padding: 11px 18px;
  font-size: 14.5px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition:
    transform 0.12s,
    box-shadow 0.2s,
    background 0.2s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.primary {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 86%, #ffffff) 0%,
    var(--ms-accent, var(--ms-accent)) 100%
  );
  color: var(--ms-on-accent);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--ms-accent, var(--ms-accent)) 28%, transparent);
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn.ghost {
  background: var(--ms-surface);
  color: var(--ms-icon);
  border: 1.5px solid var(--ms-border);
}

.btn.ghost:hover:not(:disabled) {
  background: var(--ms-surface-2);
}

.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13.5px;
  font-weight: 600;
}

.notice.success {
  background: var(--ms-ok-bg);
  color: var(--ms-accent-strong);
}

.notice.error {
  background: var(--ms-danger-bg);
  color: var(--ms-danger);
}

.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid var(--ms-border);
  border-top-color: var(--ms-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.spinner.light {
  border-color: color-mix(in srgb, var(--ms-on-accent) 40%, transparent);
  border-top-color: var(--ms-on-accent);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Ссылка на профиль: строку адреса можно выделить целиком и скопировать */
.profile-link-hint {
  margin: 0 0 12px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--ms-muted);
}

.profile-link-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.profile-link-input {
  flex: 1 1 240px;
  min-width: 0;
  box-sizing: border-box;
  border: 1.5px solid var(--ms-border);
  border-radius: 11px;
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  color: var(--ms-text-strong);
  background: var(--ms-surface-2);
  outline: none;
}

.profile-link-row .btn {
  flex: 0 0 auto;
  padding: 10px 14px;
  font-size: 14px;
}

/* QR-код над строкой адреса: первым в карточке (как в Telegram), по центру */
.profile-link-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ms-space-2);
  margin-bottom: var(--ms-space-4);
}

.profile-link-qr-hint {
  margin: 0;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted);
  text-align: center;
}

@media (max-width: 560px) {
  .profile-link-row .btn {
    flex: 1 1 auto;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 560px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
