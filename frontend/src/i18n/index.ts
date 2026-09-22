/**
 * Язык интерфейса: русский (исходный) и английский.
 *
 * Библиотека локализации намеренно не подключена. `vue-i18n` весит десятки
 * килобайт в основном чанке, а его установка в этом проекте ломает дерево
 * `node_modules` (оно частично root-овое, см. `docs/frontend.md`) — поэтому
 * переводит своя маленькая функция `t()`.
 *
 * КЛЮЧ ПЕРЕВОДА — САМ РУССКИЙ ТЕКСТ, а не придуманное имя:
 *  1. правка компонента — это обернуть строку в `t('...')`, без выдумывания
 *     ключей и без риска «потерять» серверный `detail` (его подставляет бэкенд,
 *     а не наш каталог);
 *  2. непереведённый текст просто остаётся русским: фолбэк — исходная строка.
 *     Поэтому перевод делается по частям, и приложение остаётся рабочим.
 *
 * Динамические части пишутся фигурными скобками:
 * `t('Добавляем {done} из {total}', { done, total })`.
 *
 * Язык берётся ТОЛЬКО из профиля (`profile.language`, см. `stores/auth.ts`);
 * поле хранит сервер, поэтому выбор переживает переустановку приложения.
 * До загрузки профиля интерфейс русский.
 */

import { computed, shallowRef, type Ref } from 'vue'

/** Языки, которые приложение РЕАЛЬНО умеет показывать. */
export type Locale = 'ru' | 'en'

/**
 * Список для выпадающего списка в настройках.
 *
 * Здесь только те языки, для которых есть перевод: пункт, который ничего не
 * меняет, — это обман (раньше в списке стояли ещё es/de/fr без перевода).
 */
export const LOCALES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' }
]

/** Язык по умолчанию: исходный текст интерфейса — русский. */
export const DEFAULT_LOCALE: Locale = 'ru'

/** Текущий язык. Читается в `t()`, поэтому шаблоны реагируют на смену. */
export const locale: Ref<Locale> = shallowRef(DEFAULT_LOCALE)

/** Каталог английских переводов; грузится лениво, чтобы не платить за него всем. */
const catalog = shallowRef<Record<string, string>>({})

/** Приводит значение с сервера к поддерживаемому языку (`en` → `en`, прочее → `ru`). */
export function normalizeLocale(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : DEFAULT_LOCALE
}

/**
 * Меняет язык интерфейса.
 *
 * Английский каталог подключается динамическим импортом: он нужен только тем,
 * кто выбрал английский, а лежать в основном чанке он бы увеличил загрузку
 * приложения для всех (бюджет бандла следит `scripts/check-bundle-size.mjs`).
 * До загрузки каталога интерфейс остаётся русским — переключение произойдёт
 * само (`catalog` — ref, шаблоны перерисуются).
 */
export function setLocale(value: string | null | undefined): void {
  const next = normalizeLocale(value)
  locale.value = next
  syncDocumentLocale(next)
  if (next !== 'en' || Object.keys(catalog.value).length > 0) return
  void import('./en').then((module) => {
    catalog.value = module.EN
  })
}

/**
 * Синхронизирует язык документа с языком интерфейса.
 *
 * Quasar при старте выставляет `<html lang>` из своей локали, а в `main.ts`
 * подключена только русская — из-за этого при английском интерфейсе документ
 * оставался `lang="ru"` (от этого зависят автоперевод браузера и скринридеры).
 *
 * Локали самого Quasar при этом НЕ переключаем: приложение использует только
 * компоненты без внутренних подписей (`q-icon`, `q-btn`, `q-card`, `q-dialog`…),
 * а `$q.dialog`/`$q.notify` не вызываются вовсе — текстов от Quasar человек не
 * видит. Языковые пакеты весят килобайты и `manualChunks` положил бы их в общий
 * чанк `quasar`, то есть за них платили бы все (см. `scripts/check-bundle-size.mjs`).
 */
function syncDocumentLocale(next: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = next
}

/** Язык загружен (для тестов и скрипта проверки переводов). */
export const catalogLoaded = computed(() => Object.keys(catalog.value).length > 0)

/**
 * Переводит исходный (русский) текст.
 *
 * `vars` подставляет значения в `{места}` — так переводятся строки с числами и
 * именами. Подстановок в русском источнике нет вовсе: их добавляет сам вызов,
 * поэтому ключ в каталоге пишется с фигурными скобками.
 */
export function t(source: string, vars?: Record<string, string | number>): string {
  const text = locale.value === 'ru' ? source : (catalog.value[source] ?? source)
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole
  )
}

/**
 * Локаль для `toLocaleDateString`/`toLocaleTimeString` (даты — тоже интерфейс).
 *
 * Для английского берём `en-GB`, а не `en-US`: в американской локали время
 * выводится 12-часовым («12:12 PM»), а у нас везде 24-часовое, как в русском
 * интерфейсе. Порядок частей даты в `en-GB` тоже совпадает с привычным
 * (день, затем месяц).
 */
export const dateLocale = (): string => (locale.value === 'en' ? 'en-GB' : 'ru-RU')

/**
 * Число с правильной формой слова.
 *
 * Русские формы (одна / две-четыре / много) приходят тремя строками, английские
 * (единственное / множественное) — двумя: в английском правило проще, и
 * сохранять его ради «красоты» отдельной функцией смысла нет.
 */
export function plural(
  n: number,
  ru: readonly [string, string, string],
  en: readonly [string, string]
): string {
  if (locale.value === 'en') return n === 1 ? en[0] : en[1]
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return ru[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return ru[1]
  return ru[2]
}
