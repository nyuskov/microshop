/**
 * Собирает английские версии юридических страниц: `public/*-en.html`.
 *
 * Зачем генератор, а не «просто ещё три файла»: разметка и стили у русской и
 * английской версии должны совпадать (иначе правка оформления разъедется), а
 * переводить приходится только текст. Скрипт берёт из русского файла всё, что
 * до `<main>` и после `</main>` (шапка, CSS, хвост), и подставляет английский
 * `<main>`, переводы лежат здесь же — в одном месте.
 *
 * На английской странице стоит пометка о том, что при расхождении действует
 * русская редакция: это перевод для удобства, а не новая редакция документа.
 *
 * Запуск: `node scripts/build-legal-en.mjs` (в `frontend/`).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PUBLIC = resolve(process.cwd(), 'public')

/** Пометка о приоритете русской редакции (одна на все страницы). */
const note = (ruPath) =>
  `      <p class="updated">This is an English translation provided for convenience. ` +
  `If anything in it differs from the Russian version at ` +
  `<a href="${ruPath}">pismo.space${ruPath}</a>, the Russian version prevails.</p>`

const PAGES = [
  {
    ru: 'terms.html',
    en: 'terms-en.html',
    titleRu: 'Пользовательское соглашение — Pismo',
    titleEn: 'Terms of Service — Pismo',
    ruPath: '/terms.html',
    body: `      <h1>Pismo Terms of Service</h1>
${note('/terms.html')}
      <p class="updated">Last updated: 10 September 2026</p>

      <h2>1. General provisions</h2>
      <p>
        This Agreement is a public offer (Article 437 of the Civil Code of the Russian Federation)
        and defines the terms of use of the <strong>Pismo</strong> messaging service (the
        “Service”), available at <a href="https://pismo.space">pismo.space</a>, including the web
        version and the Android app.
      </p>
      <p>
        The Service is operated by an individual, <strong>Nyuskov Nikita Valeryevich</strong> (the
        “Operator”). Contact: <a href="mailto:nyuskov@gmail.com">nyuskov@gmail.com</a>.
      </p>
      <p>
        Acceptance of the offer (full and unconditional agreement to the terms) is registration in
        the Service: providing a phone number and confirming the code. From the moment of
        acceptance the Agreement is considered concluded between the user and the Operator. If the
        user does not agree with the terms, they must stop using the Service.
      </p>

      <h2>2. Subject of the Agreement</h2>
      <ul>
        <li>
          The Operator grants the user a free-of-charge right to use the Service features:
          text messaging, files and media, audio and video calls, chats, search across chats and
          other interface features.
        </li>
        <li>
          The Service is provided “as is”. The Operator may change the set of features, introduce
          technical limits (including a limit on the size of uploaded files — currently 500 MB per
          user) and suspend the Service for maintenance.
        </li>
        <li>
          The Service is currently free. If paid features appear, users will be informed in advance,
          and they will not become mandatory.
        </li>
      </ul>

      <h2>3. Registration and account</h2>
      <ul>
        <li>
          Using the Service requires an account linked to a phone number. The user provides
          accurate data and keeps it up to date.
        </li>
        <li>
          The Service is not intended for persons under <strong>14</strong>. By registering, the
          user confirms that they have reached this age.
        </li>
        <li>
          The user is responsible for keeping access to the account safe (password, access to
          e-mail and to the devices where they are signed in) and for actions performed under their
          account.
        </li>
        <li>
          To protect the account, the Operator may apply additional checks — for example,
          confirming a sign-in from a new device with a code sent by e-mail, rate limits, and
          keeping a security event log (180 days, available to the user in the profile).
        </li>
        <li>
          The user may delete the account at any time in the profile. Deletion is irreversible:
          chats, attachments and account data are deleted, backups — within 30 days.
        </li>
      </ul>

      <h2>4. Rules of use</h2>
      <p>
        The user undertakes to follow the
        <a href="/community-en.html">Community Rules</a>, which are an integral part of this
        Agreement. The following is prohibited: distributing malicious code; spam and bulk
        messaging; materials that violate the law (including extremist materials, materials
        related to drugs, weapons, or sexual content involving minors); threats, harassment,
        incitement of hatred; publishing other people's personal data without consent;
        impersonating another person; circumventing technical restrictions and protection
        mechanisms of the Service; collecting other users' data by automated means.
      </p>
      <p>The user is responsible for the content of the messages and files they send.</p>

      <h2>5. Moderation and reports</h2>
      <ul>
        <li>
          A user can report a message or a user. The report is reviewed by a moderator.
        </li>
        <li>
          If a message receives <strong>3 reports from different users</strong>, it is hidden
          automatically until review: other participants do not see it, it is excluded from search,
          pinned messages and previews, and it cannot be forwarded. The author sees it marked as
          hidden and receives an e-mail notification.
        </li>
        <li>
          After the review the moderator either keeps the message hidden (the report is upheld) or
          restores it (the report is dismissed). The reporter is notified of the decision.
        </li>
        <li>
          Decisions are recorded in the moderation journal, including automatic hiding.
        </li>
        <li>
          For repeated violations the Operator may restrict access: warn the user, hide individual
          messages or block the account. A decision can be appealed by writing to
          <a href="mailto:nyuskov@gmail.com">nyuskov@gmail.com</a> and stating the username.
        </li>
      </ul>

      <h2>6. User content</h2>
      <ul>
        <li>Rights to messages, files and other materials remain with the user.</li>
        <li>
          The user grants the Operator the right to store, process and transmit their content to
          the recipient to the extent necessary for the Service to work (message delivery, history
          storage, notifications, security).
        </li>
        <li>
          In chats with end-to-end encryption the keys are stored on users' devices — the Service
          keeps such messages only in encrypted form and cannot read them.
        </li>
      </ul>

      <h2>7. Personal data</h2>
      <p>
        Personal data is processed in accordance with the
        <a href="/privacy-en.html">Privacy Policy</a>, which is an integral part of this Agreement.
        Consent to processing is given at registration; it can be withdrawn by deleting the account
        or by contacting the address above.
      </p>

      <h2>8. Liability</h2>
      <ul>
        <li>
          The Service is provided without guarantees of uninterrupted operation. The Operator aims
          for high availability but is not liable for interruptions caused by technical failures,
          updates, third-party actions or force majeure.
        </li>
        <li>
          The Operator is not liable for the content of users' messages, for the consequences of
          using or being unable to use the Service, or for indirect losses.
        </li>
        <li>
          The Operator may suspend access to the Service for a user who has violated this Agreement
          or the law.
        </li>
      </ul>

      <h2>9. Changes to the terms</h2>
      <p>
        The Operator may change this Agreement: the new version is published at
        <a href="/terms-en.html">pismo.space/terms-en.html</a> with the date of the update. Users
        are notified about material changes in the Service. Continued use after the changes are
        published means agreement with the new version; if the user disagrees, they may stop using
        the Service and delete the account.
      </p>

      <h2>10. Governing law and disputes</h2>
      <p>
        This Agreement is governed by the law of the Russian Federation. Disputes are resolved
        through negotiations (via the contact address) and, if no agreement is reached, in the
        manner established by law.
      </p>

      <div class="links">
        <a href="/privacy-en.html">Privacy Policy</a>
        <a href="/community-en.html">Community Rules</a>
      </div>`
  },
  {
    ru: 'privacy.html',
    en: 'privacy-en.html',
    titleRu: 'Политика конфиденциальности — Pismo',
    titleEn: 'Privacy Policy — Pismo',
    ruPath: '/privacy.html',
    body: `      <h1>Pismo Privacy Policy</h1>
${note('/privacy.html')}
      <p class="updated">Last updated: 10 September 2026</p>

      <h2>1. Data controller</h2>
      <p>
        The personal data controller is an individual, <strong>Nyuskov Nikita Valeryevich</strong>.
        Contact for any requests about personal data processing (access, correction, blocking,
        deletion, withdrawal of consent): <code>nyuskov@gmail.com</code>.
      </p>

      <h2>2. What data we process</h2>
      <p>Pismo is a messenger. We process only the data without which it cannot work:</p>
      <ul>
        <li>
          <strong>Account data</strong>: phone number (login), confirmation code, first and last
          name, username, e-mail (if provided), date of birth, country, language, status, avatar.
        </li>
        <li>
          <strong>Chat content</strong>: text messages, attachments (images, videos, voice
          messages, files), reactions, service data (time, author, read receipts). Chats with
          end-to-end encryption (E2EE) are stored on the server only in encrypted form — the keys
          are on users' devices, and we cannot read such messages.
        </li>
        <li>
          <strong>At your request</strong>: choosing a person from contacts, searching users by
          name or number.
        </li>
        <li>
          <strong>Technical data</strong>: IP address, device and browser type, app version, request
          logs, push subscription identifier, crash data.
        </li>
        <li>
          <strong>Camera and microphone</strong>: used only during an audio/video call and when
          recording voice messages. The call media stream goes directly between participants
          (WebRTC).
        </li>
      </ul>
      <p>
        We do not process biometric data, do not collect geolocation, do not use data for
        advertising and do not share it with third parties for marketing.
      </p>

      <h2>3. Why we process data (purposes)</h2>
      <p>All processing purposes relate to a single service — messaging via Pismo:</p>
      <ul>
        <li>registration and sign-in (verifying the phone number);</li>
        <li>delivery and storage of messages, files and media;</li>
        <li>notifications about new messages and incoming calls (push);</li>
        <li>
          security: protection from spam, code brute-forcing and unauthorised access, rate limiting,
          warnings about a sign-in from a new device and about password/e-mail changes;
        </li>
        <li>user support and fixing technical failures.</li>
      </ul>

      <h2>4. Legal grounds</h2>
      <p>
        Processing is carried out on the basis of the user's consent (Article 6 of Federal Law
        No. 152-FZ “On Personal Data”), given at registration, and for the purpose of performing
        the agreement on the use of the service —
        <a href="/terms-en.html">Terms of Service</a>, which the user concludes at registration.
      </p>

      <h2>5. Storage and protection</h2>
      <ul>
        <li>data is stored on servers located in the territory of the Russian Federation;</li>
        <li>data transfer between the app and the server is protected with TLS/HTTPS encryption;</li>
        <li>access to data is limited to the people maintaining the service;</li>
        <li>
          for certain chats end-to-end encryption (E2EE) is available: the content of such messages
          is not available to the server;
        </li>
        <li>
          storage period — as long as the account exists; after account deletion the data is
          deleted, and backups — within 30 days.
        </li>
      </ul>

      <h2>6. Sharing with third parties</h2>
      <p>
        Data is not sold and is not shared with third parties, except when it is necessary for the
        service to work (for example, delivering push notifications via a push service operator) or
        required by law.
      </p>
      <p>
        <strong>Transfer outside the Russian Federation (cross-border transfer).</strong>
        Notifications about new messages in the browser are delivered through browser vendors'
        push services: Google (Chrome, Edge, Opera — USA), Apple (Safari), Mozilla (Firefox). For
        delivery abroad we transfer the push subscription identifier of your device (delivery
        service address and encryption keys), the sender's name and the notification text (no more
        than 120 characters). Push notifications can be turned off in the profile — then such
        transfer stops. Notifications for the Android app are delivered via the RuStore service
        (Russia). All other data, including chats and attachments, is processed and stored on
        servers located in the Russian Federation and is not transferred abroad.
      </p>

      <h2>7. Your rights</h2>
      <ul>
        <li>to obtain information about the processing of your personal data;</li>
        <li>to correct data in the app profile;</li>
        <li>
          to withdraw consent and delete the account — by writing to
          <code>nyuskov@gmail.com</code>;
        </li>
        <li>to appeal the controller's actions to Roskomnadzor or to a court.</li>
      </ul>

      <h2>8. Children</h2>
      <p>
        The Service is not intended for persons under 14. We do not knowingly collect children's
        data; if such data is discovered, it will be deleted.
      </p>

      <h2>9. Changes to the policy</h2>
      <p>
        The current version is always available at
        <a href="https://pismo.space/privacy-en.html">https://pismo.space/privacy-en.html</a>.
        We notify users about material changes in the app.
      </p>

      <h2>10. Contacts</h2>
      <p>
        For any questions about personal data processing:
        <code>nyuskov@gmail.com</code>.
      </p>`
  },
  {
    ru: 'community.html',
    en: 'community-en.html',
    titleRu: 'Правила сообщества — Pismo',
    titleEn: 'Community Rules — Pismo',
    ruPath: '/community.html',
    body: `      <h1>Pismo Community Rules</h1>
${note('/community.html')}
      <p class="updated">Last updated: 10 September 2026</p>

      <p>
        Pismo is a messenger for personal communication, file sharing and calls. The rules below
        apply to everyone: in private chats and in groups. They exist to keep the service safe and
        are part of the Terms of Service.
      </p>

      <h2>1. What is allowed</h2>
      <ul>
        <li>personal communication, exchanging messages, files, photos/videos and voice messages;</li>
        <li>group chats for friends, family, work or study;</li>
        <li>audio and video calls;</li>
        <li>criticising ideas, arguing, discussing any topic — politely and on the merits.</li>
      </ul>

      <h2>2. What is prohibited</h2>
      <ol>
        <li>
          <strong>Threats, harassment, stalking.</strong> Intimidation, targeted harassment,
          incitement of hatred based on race, nationality, religion, sex, orientation or health.
        </li>
        <li>
          <strong>Sexual content involving minors</strong> — prohibited entirely, without
          exceptions. Such cases are reported to law enforcement.
        </li>
        <li>
          <strong>Violence and shock content.</strong> Images and videos of real violence,
          dismemberment, cruelty to people and animals.
        </li>
        <li>
          <strong>Fraud.</strong> Ponzi schemes, “prizes”, requests to transfer money under false
          pretexts, phishing links, selling goods that do not exist.
        </li>
        <li>
          <strong>Spam and unsolicited advertising.</strong> Bulk messaging, invitations from
          purchased phone number databases, pushing services.
        </li>
        <li>
          <strong>Malware and bypassing protection.</strong> Viruses, malicious files, programs for
          stealing passwords and data.
        </li>
        <li>
          <strong>Other people's personal data.</strong> Publishing someone's addresses, numbers,
          documents or chats without the owner's consent.
        </li>
        <li>
          <strong>Violating the law.</strong> Anything prohibited by the law of the Russian
          Federation, including materials recognised as extremist.
        </li>
        <li>
          <strong>Deceiving the service.</strong> Accounts created to bypass blocks, automated
          boosting, attempts to gain access to other people's accounts.
        </li>
      </ol>

      <h2>3. How to report</h2>
      <ul>
        <li><strong>A message:</strong> long-press or the message menu → “Report”.</li>
        <li><strong>A person:</strong> the private chat header → “⋯” → “Report”.</li>
        <li>
          <strong>Block the offender:</strong> in the same menu → “Block” (they will not be able to
          write, and the chat is hidden from the list).
        </li>
      </ul>
      <p>
        A report goes to the moderator together with the context (message text, chat, time).
        Abusing reports (for example, mass-reporting good-faith users) is itself a violation.
      </p>

      <h2>4. What happens to offenders</h2>
      <ol>
        <li>
          A message may be <strong>hidden automatically</strong> before review: if three different
          users reported it. The author then sees the “hidden until review” mark and can fix or
          delete the message.
        </li>
        <li>
          The moderator reviews the report and makes one of the decisions: “violation not
          confirmed” (the content is restored and the reporter receives an e-mail) or “violation
          confirmed” (the content stays hidden and the reporter receives an e-mail with the
          decision).
        </li>
        <li>
          Depending on the severity and repetition of violations: a warning, a restriction on
          sending messages, blocking the account, deleting the account.
        </li>
        <li>
          In cases of clear threats to life and health, and in cases involving minors, we contact
          law enforcement.
        </li>
      </ol>
      <p>
        All actions are recorded in the moderation journal (who, when, what and why) — this is
        needed so that decisions can be traced.
      </p>

      <h2>5. Appeals</h2>
      <p>
        If you believe a moderator's decision is wrong, write to
        <code>nyuskov@gmail.com</code>: state the account phone number, describe the situation and
        attach a screenshot if it helps. We reply within 3 business days and review the decision if
        there are grounds for it.
      </p>

      <h2>6. Children</h2>
      <p>
        The Service is not intended for persons under 14. If it becomes known that an account is
        used by a child under 14, the account will be deleted.
      </p>

      <h2>7. Changes to the rules</h2>
      <p>
        The current version is always available at
        <a href="https://pismo.space/community-en.html">https://pismo.space/community-en.html</a>.
        We report material changes in the app.
      </p>

      <h2>8. Contacts</h2>
      <p>Questions about the rules and moderation: <code>nyuskov@gmail.com</code>.</p>

      <p>
        See also the
        <a href="/privacy-en.html">Privacy Policy</a>.
      </p>
      <a class="back" href="/">← Back to Pismo</a>`
  }
]

for (const page of PAGES) {
  const ru = readFileSync(resolve(PUBLIC, page.ru), 'utf8')
  const headEnd = ru.indexOf('<main>')
  const mainEnd = ru.indexOf('</main>')
  if (headEnd < 0 || mainEnd < 0) throw new Error(`нет <main> в ${page.ru}`)

  const head = ru
    .slice(0, headEnd)
    .replace('<html lang="ru">', '<html lang="en">')
    .replace(`<title>${page.titleRu}</title>`, `<title>${page.titleEn}</title>`)
  const tail = ru.slice(mainEnd)

  writeFileSync(resolve(PUBLIC, page.en), `${head}<main>\n${page.body}\n    ${tail}`, 'utf8')
  console.log(`готово: public/${page.en}`)
}
