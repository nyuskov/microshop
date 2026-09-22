/**
 * Режим технических работ: глобальное состояние экрана-заглушки.
 *
 * Пока сервис сознательно недоступен (обновление, миграция, разбор инцидента),
 * человек должен видеть понятное «идут технические работы», а не сыпать ошибками
 * и полупустыми списками. Включает и выключает режим администратор из админской
 * панели, а фронтенд узнаёт о нём двумя путями:
 *
 *  - из ответа 503 с кодом `maintenance` (так отвечает любой запрос к API);
 *  - из публичного статуса, который опрашивает `useMaintenanceWatch`.
 *
 * Заглушка при этом НЕ закрывает экран входа: сервер `/auth/` и `/jwt/` пускает —
 * «войди и выключи режим», и мешать этому глупо. Пока человек не вошёл, о работах
 * говорит строка на экране входа (`Login.vue`).
 *
 * Модуль намеренно без внешних зависимостей (только `vue`): его импортирует
 * `services/api.ts`, а тот не должен тянуть за собой сервисы запросов — иначе
 * получается цикл импортов.
 */

import { computed, ref } from 'vue'

import { t } from '@/i18n'

/** Код в `detail.code` ответа 503: по нему отличаем техработы от аварии. */
export const MAINTENANCE_CODE = 'maintenance'

/** Текст по умолчанию: его показываем, если сервер своего не прислал. */
export const defaultMaintenanceText = (): string => t('Скоро вернёмся.')

/**
 * Сервер сообщил, что идут техработы (личность смотрящего здесь ни при чём).
 *
 * Это «правда сервера». Показывать ли из-за неё полноэкранную заглушку — решает
 * `maintenanceActive` ниже.
 */
export const maintenanceRunning = ref(false)

/** Текст на экране техработ (задаёт администратор, иначе текст по умолчанию). */
export const maintenanceText = ref(defaultMaintenanceText())

/**
 * Администратор сервиса: ему экран НЕ показываем.
 *
 * Сервер пускает администратора во время техработ (иначе режим было бы нечем
 * выключить), поэтому и приложение не должно закрываться перед ним: он войдёт,
 * откроет админскую панель и снимет режим. Значение ставит `App.vue`, следя за
 * признаком администратора в сторе авторизации (сам модуль его не импортирует,
 * чтобы не получить цикл: `services/api.ts` → `utils/maintenance.ts` → стор → тот
 * же `services/api.ts`).
 */
const viewerIsAdmin = ref(false)

/**
 * Человек вошёл в аккаунт — и только тогда заглушка уместна.
 *
 * Пока входа нет, перед человеком экран ВХОДА, и закрывать его заглушкой нельзя:
 * сервер `/auth/` и `/jwt/` пускает специально — «войди и выключи режим». На
 * живом проде 22.09.2026 было наоборот: владелец видел заглушку вместо входа и
 * снимал режим скриптом по ssh.
 */
const viewerIsAuthenticated = ref(false)

/**
 * Показывать ли полноэкранный экран технических работ прямо сейчас.
 *
 * Три условия сразу: сервер сказал, что режим включён; человек вошёл; он не
 * администратор. Без второго условия (или при третьем) вместо заглушки виден
 * обычный экран (вход или приложение) с пометкой о работах — см. `Login.vue`.
 */
export const maintenanceActive = computed(
  () => maintenanceRunning.value && viewerIsAuthenticated.value && !viewerIsAdmin.value
)

/** Отметить, что за экраном работает администратор (или он вышел из аккаунта). */
export function setMaintenanceExempt(value: boolean): void {
  viewerIsAdmin.value = value
}

/** Отметить, вошёл ли человек (снял вход — показываем экран входа, не заглушку). */
export function setMaintenanceViewerAuthenticated(value: boolean): void {
  viewerIsAuthenticated.value = value
}

/**
 * Текст техработ из ответа сервера — или `null`, если это не техработы.
 *
 * Проверка структурная (без `axios`), чтобы модуль оставался «листовым»: важно
 * отличать именно наш 503 с кодом, а не любую ошибку сервера — иначе экран
 * техработ вылезал бы и при аварии API.
 */
export function maintenanceMessageOf(error: unknown): string | null {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null)
    ?.response
  if (!response || response.status !== 503) return null

  const detail = response.data?.detail
  if (!detail || typeof detail !== 'object') return null
  if ((detail as { code?: unknown }).code !== MAINTENANCE_CODE) return null

  const message = (detail as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message : defaultMaintenanceText()
}

/** Включает экран технических работ (решение «показывать или нет» — в `maintenanceActive`). */
export function showMaintenance(message?: string | null): void {
  maintenanceText.value = message?.trim() ? message : defaultMaintenanceText()
  maintenanceRunning.value = true
}

/** Убирает экран технических работ (режим выключили). */
export function hideMaintenance(): void {
  maintenanceRunning.value = false
  maintenanceText.value = defaultMaintenanceText()
}
