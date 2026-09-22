/**
 * Модальные окна приложения: подтверждение, сообщение и ввод текста.
 *
 * Зачем не `window.confirm`/`alert`/`prompt`: штатные окна браузера рисуются вне
 * приложения — со своей типографикой, без тёмной темы и без учёта мобильной
 * вёрстки (в PWA-режиме они выглядят как «чужое» окно поверх нашего), а в
 * некоторых встроенных браузерах их вообще подавляют. Плюс на них нельзя
 * повлиять: ни текст кнопок, ни порядок, ни «опасное» действие красным.
 *
 * Здесь тонкая обёртка над `Dialog` из Quasar: он уже подключён в `main.ts`, а
 * карточка `q-card` берёт цвета из токенов темы (`assets/quasar.css`), поэтому
 * появление окна ничего не стоит по вёрстке.
 *
 * API — промисы: `if (!(await confirmDialog({...}))) return` читается лучше, чем
 * колбэки, и повторяет привычную форму штатных диалогов.
 */

import { Dialog } from 'quasar'

import { pushMobileLayer } from '@/composables/useMobileOverlay'
import { t } from '@/i18n'

/** Общие поля любого окна: заголовок и текст вопроса. */
interface BaseOptions {
  title: string
  /** Текст под заголовком. Необязателен: иногда всё ясно из заголовка. */
  message?: string
}

export interface ConfirmOptions extends BaseOptions {
  /** Подпись кнопки подтверждения (по умолчанию «ОК»). */
  okLabel?: string
  cancelLabel?: string
  /** Опасное действие: кнопка подтверждения красная. */
  danger?: boolean
}

export interface AskTextOptions extends BaseOptions {
  /** Подпись под полем ввода (что именно вводит человек). */
  label?: string
  placeholder?: string
  /** `password` — поле скрывает символы (например, подтверждение паролем). */
  type?: 'text' | 'password'
  okLabel?: string
  cancelLabel?: string
  /** Проверка введённого: `false` — кнопка «ОК» неактивна. */
  isValid?: (value: string) => boolean
}

/** Класс для всех окон приложения: общая ширина и отступы (`assets/quasar.css`). */
const DIALOG_CLASS = 'app-dialog'

/** Подтверждение действия. `true` — человек согласился. */
export const confirmDialog = (options: ConfirmOptions): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false
    const dialog = Dialog.create({
      class: DIALOG_CLASS,
      title: options.title,
      message: options.message,
      persistent: true,
      ok: {
        label: options.okLabel ?? t('ОК'),
        color: options.danger ? 'negative' : 'primary',
        unelevated: true,
        noCaps: true
      },
      cancel: {
        label: options.cancelLabel ?? t('Отмена'),
        flat: true,
        noCaps: true
      }
    })
    // Слой мобильной навигации: на телефоне системное «назад» закрывает вопрос
    // (= «отмена»), а не выходит из приложения из-под него.
    const releaseLayer = pushMobileLayer(() => dialog.hide())
    dialog
      .onOk(() => {
        answered = true
        resolve(true)
      })
      .onCancel(() => {
        answered = true
        resolve(false)
      })
      .onDismiss(() => {
        // Клик мимо окна/Esc/системное «назад» — это «нет». Без этого промис
        // остался бы висеть.
        if (!answered) resolve(false)
        releaseLayer()
      })
  })

/** Сообщение с одной кнопкой. Ждём закрытия, чтобы не гнаться за ним дальше. */
export const alertDialog = (options: BaseOptions & { okLabel?: string }): Promise<void> =>
  new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    const dialog = Dialog.create({
      class: DIALOG_CLASS,
      title: options.title,
      message: options.message,
      persistent: true,
      ok: {
        label: options.okLabel ?? t('Понятно'),
        color: 'primary',
        unelevated: true,
        noCaps: true
      }
    })
    const releaseLayer = pushMobileLayer(() => dialog.hide())
    dialog.onOk(finish).onDismiss(() => {
      finish()
      releaseLayer()
    })
  })

/**
 * Ввод текста (замена `window.prompt`).
 *
 * Возвращает введённое значение или `null`, если человек отказался: пустая
 * строка — это тоже ввод, и путать её с отказом нельзя.
 */
export const askTextDialog = (options: AskTextOptions): Promise<string | null> =>
  new Promise((resolve) => {
    let answered = false
    const dialog = Dialog.create({
      class: DIALOG_CLASS,
      title: options.title,
      message: options.message,
      persistent: true,
      prompt: {
        model: '',
        type: options.type ?? 'text',
        label: options.label,
        placeholder: options.placeholder,
        isValid: (value: string) => (options.isValid ? options.isValid(value) : true)
      },
      ok: {
        label: options.okLabel ?? t('ОК'),
        color: 'primary',
        unelevated: true,
        noCaps: true
      },
      cancel: {
        label: options.cancelLabel ?? t('Отмена'),
        flat: true,
        noCaps: true
      }
    })
    const releaseLayer = pushMobileLayer(() => dialog.hide())
    dialog
      .onOk((value: string) => {
        answered = true
        resolve(value ?? '')
      })
      .onCancel(() => {
        answered = true
        resolve(null)
      })
      .onDismiss(() => {
        if (!answered) resolve(null)
        releaseLayer()
      })
  })
