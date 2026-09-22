/**
 * Ссылки на юридические документы (соглашение, политика, правила сообщества).
 *
 * Документы лежат статикой рядом с приложением: русский оригинал
 * (`/terms.html`) и английский перевод (`/terms-en.html`) с пометкой, что при
 * расхождении действует русская редакция (см. `scripts/build-legal-en.mjs`).
 *
 * Почему по языку интерфейса, а не по языку системы: язык человек выбирает в
 * профиле, и документ открывается в новой вкладке уже после входа — значит
 * язык известен и его же ждут в тексте.
 */
import { locale } from '@/i18n'

export type LegalDocument = 'terms' | 'privacy' | 'community'

/** Имя файла без языка: `terms` → `/terms.html` и `/terms-en.html`. */
const FILES: Record<LegalDocument, string> = {
  terms: 'terms',
  privacy: 'privacy',
  community: 'community'
}

/** Адрес документа на текущем языке интерфейса. */
export const legalUrl = (document: LegalDocument): string => {
  const file = FILES[document]
  return locale.value === 'en' ? `/${file}-en.html` : `/${file}.html`
}
