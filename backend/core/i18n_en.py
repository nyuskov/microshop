"""Английские переводы серверных текстов.

Ключ — русский текст как он написан в коде, значение — английский. Каталог
пополняется по мере перевода модулей; отсутствие строки здесь означает «пока
остаётся по-русски» (см. `core/i18n.py`).

Правила перевода:
* подстановки `{name}` сохраняются как есть (порядок слов в английском может
  быть другим — это нормально, важен сам плейсхолдер);
* тон — как в приложении: коротко, без канцелярита и без «Ошибка:» там, где и
  так понятно из контекста;
* точка в конце — только если фраза полная (у коротких подписей её нет).
"""

from __future__ import annotations

EN: dict[str, str] = {
    # --- Доступ и права ---
    "Админ не может исключать другого админа": "An admin cannot remove another admin",
    "Админ не может ограничивать другого админа": "An admin cannot restrict another admin",
    "Владелец не может отписаться: удалите канал или передайте права": (
        "The owner cannot unsubscribe: delete the channel or transfer the rights"
    ),
    "Владельца нельзя назначить или снять админом": (
        "The owner cannot be appointed or removed as admin"
    ),
    "Аудитория видна только автору истории": (
        "The audience is visible only to the author of the story"
    ),
    "Бан-лист виден админам группы": "The ban list is visible to group admins",
    "Изменять группу могут только создатель и админы": (
        "Only the creator and admins can change the group"
    ),
    "Менять аватар могут только создатель и админы": (
        "Only the creator and admins can change the avatar"
    ),
    "Назначать админов может только владелец канала": (
        "Only the channel owner can appoint admins"
    ),
    "Назначать админов может только создатель группы": (
        "Only the group creator can appoint admins"
    ),
    "Недостаточно прав": "Not enough rights",
    "Недостаточно прав для добавления участников": "Not enough rights to add members",
    "Недостаточно прав для исключения участника": (
        "Not enough rights to remove a member"
    ),
    "Недостаточно прав для настройки медленного режима": (
        "Not enough rights to configure slow mode"
    ),
    "Недостаточно прав для ограничения участников": (
        "Not enough rights to restrict members"
    ),
    "Недостаточно прав для снятия бана": "Not enough rights to lift the ban",
    "Нужны права администратора канала": "Channel admin rights are required",
    "Приглашать по ссылке могут создатель и админы": (
        "Only the creator and admins can invite by link"
    ),
    "Создателя группы ограничить нельзя": "The group creator cannot be restricted",
    "Статистика видна только участникам чата": (
        "Statistics are visible only to chat members"
    ),
    "Удалить группу может только её создатель": (
        "Only the group creator can delete the group"
    ),
    "Шифрование группы включает создатель или админ": (
        "The group creator or an admin enables encryption"
    ),
    # --- Ошибки доступа к объектам ---
    "В этом сообщении нет картинки": "There is no image in this message",
    "Группа больше не существует": "The group no longer exists",
    "Группа не найдена": "The group was not found",
    "Диапазон за пределами файла": "The range is outside the file",
    "Жалоба не найдена": "The report was not found",
    "История больше не доступна": "The story is no longer available",
    "История не найдена": "The story was not found",
    "История не найдена или не ваша": "The story was not found or is not yours",
    "Канал не найден": "The channel was not found",
    "Комментарий не найден": "The comment was not found",
    "Медиа временно недоступно": "Media is temporarily unavailable",
    "Набор не найден": "The set was not found",
    "Напоминание не найдено": "The reminder was not found",
    "Нет доступа к этому сообщению": "No access to this message",
    "Нет доступа к этому чату": "No access to this chat",
    "Отложенное сообщение не найдено": "The scheduled message was not found",
    "Пользователь не найден": "The user was not found",
    "Пользователь не состоит в группе": "The user is not in the group",
    "Пост не найден": "The post was not found",
    "Предложение не найдено": "The suggestion was not found",
    "Приглашение не найдено.": "The invitation was not found.",
    "Сообщение не найдено": "The message was not found",
    "Ссылка не найдена": "The link was not found",
    "Ссылка не найдена — возможно, её отозвали": (
        "The link was not found — it may have been revoked"
    ),
    "Стикер не найден": "The sticker was not found",
    "Файл не найден": "The file was not found",
    "Чат не найден": "The chat was not found",
    # --- Чаты, группы, каналы ---
    "В альбом можно собрать только изображения": (
        "Only images can be collected into an album"
    ),
    "В альбом собираются только обычные картинки": (
        "Only ordinary images can be collected into an album"
    ),
    "В канале публикуют владелец и админы. Можно предложить пост.": (
        "In a channel, the owner and admins publish. You can suggest a post."
    ),
    "Вы забанены в этой группе": "You are banned in this group",
    "Вы забанены в этом канале": "You are banned in this channel",
    "Вы не подписаны на канал": "You are not subscribed to the channel",
    "Для публичного канала нужен адрес (ссылка /c/…)": (
        "A public channel needs an address (link /c/…)"
    ),
    "Зашифрованное вложение можно отправить только в зашифрованный чат": (
        "An encrypted attachment can only be sent to an encrypted chat"
    ),
    "Зашифрованные сообщения нельзя пересылать": (
        "Encrypted messages cannot be forwarded"
    ),
    "Зашифрованные сообщения нельзя редактировать": (
        "Encrypted messages cannot be edited"
    ),
    "Ключ группы доступен только для зашифрованных групп": (
        "A group key is available only for encrypted groups"
    ),
    "Максимальный мут — неделя": "The maximum mute is a week",
    "Медленный режим — от 0 до 3600 секунд": ("Slow mode is from 0 to 3600 seconds"),
    "Можно раздать ключ только участникам чата": (
        "The key can only be shared with chat members"
    ),
    "Название группы не может быть пустым": "The group name cannot be empty",
    "Нельзя заблокировать себя": "You cannot block yourself",
    "Нельзя изменить собственную роль": "You cannot change your own role",
    "Нельзя исключить создателя группы": "The group creator cannot be removed",
    "Нельзя начать переписку с самим собой": "You cannot start a chat with yourself",
    "Нельзя ответить на это сообщение": "You cannot reply to this message",
    "Нельзя отправить жалобу на себя": "You cannot report yourself",
    "Одноразовое вложение переслать нельзя": (
        "A view-once attachment cannot be forwarded"
    ),
    "Одноразовое вложение уже просмотрено": (
        "The view-once attachment has already been viewed"
    ),
    "Он не подписан на канал": "They are not subscribed to the channel",
    "Ответ на историю отправляется автору в личный чат": (
        "A reply to a story is sent to the author's private chat"
    ),
    "Пользователь забанен в этой группе — сначала снимите бан": (
        "The user is banned in this group — lift the ban first"
    ),
    "Приватный канал: вход только по ссылке-приглашению": (
        "Private channel: joining only by invite link"
    ),
    "Редактировать можно только своё сообщение": ("You can only edit your own message"),
    "Себя в контакты добавить нельзя": "You cannot add yourself to contacts",
    "Сквозное шифрование недоступно в «Сохранённых сообщениях»": (
        "End-to-end encryption is not available in Saved messages"
    ),
    "Сообщение скрыто до проверки модератором — пересылка недоступна": (
        "The message is hidden until a moderator reviews it — forwarding is unavailable"
    ),
    "«Сохранённые сообщения» нельзя удалить": "Saved messages cannot be deleted",
    "Такой адрес канала уже занят": "This channel address is already taken",
    "Удалить для всех можно только своё сообщение": (
        "You can delete for everyone only your own message"
    ),
    "Чтобы выйти из группы, нажмите «Покинуть группу»": (
        "To leave the group, tap “Leave group”"
    ),
    "Это ваша история": "This is your story",
    "Это действие не применяется к себе": ("This action cannot be applied to yourself"),
    # --- Вход, пароль, коды ---
    "Адрес подтверждён.": "The address is confirmed.",
    "Восстановление по e-mail не настроено на сервере.": (
        "E-mail recovery is not configured on the server."
    ),
    "Вход не найден (возможно, уже завершён).": (
        "The session was not found (it may already be over)."
    ),
    "Вход по e-mail не настроен на сервере.": (
        "E-mail sign-in is not configured on the server."
    ),
    "Вы вышли на всех устройствах.": "You have signed out on all devices.",
    "Для этого номера уже есть аккаунт. Войдите обычным способом.": (
        "An account already exists for this number. Sign in the usual way."
    ),
    "Код OTP отправлен.": "The OTP code has been sent.",
    "Неверное имя пользователя или пароль": "Wrong username or password",
    "Неверный или истёкший код OTP.": "The OTP code is wrong or has expired.",
    "Неверный или истёкший код из письма.": (
        "The code from the letter is wrong or has expired."
    ),
    "Неверный номер или пароль.": "Wrong phone number or password.",
    "Неверный пароль": "Wrong password",
    "Неверный пароль.": "Wrong password.",
    "Неверный формат номера телефона.": "The phone number format is wrong.",
    "Неверный формат номера телефона. Ожидается +7 (___) ___-__-__.": (
        "The phone number format is wrong. Expected: +7 (___) ___-__-__."
    ),
    "Недействительный refresh-токен": "Invalid refresh token",
    "Не удалось проверить учётные данные": "Could not verify the credentials",
    "Остальные устройства вышли из аккаунта.": (
        "The other devices have been signed out."
    ),
    "Отправка писем не настроена на сервере.": (
        "E-mail sending is not configured on the server."
    ),
    "Пароль успешно сохранён.": "The password has been saved.",
    "Подтверждение входа недействительно. Войдите заново.": (
        "The sign-in confirmation is invalid. Sign in again."
    ),
    "По этой ссылке уже зарегистрировались — отзывать нечего.": (
        "Someone has already signed up with this link — there is nothing to revoke."
    ),
    "Регистрация новых пользователей временно отключена.": (
        "Sign-up of new users is temporarily disabled."
    ),
    "Сессии уже завершены.": "The sessions have already been ended.",
    "Срок действия должен быть больше нуля дней.": (
        "The validity period must be more than zero days."
    ),
    "Ссылка больше не действует — попросите новую": (
        "The link no longer works — ask for a new one"
    ),
    "Ссылка-приглашение недействительна или уже использована.": (
        "The invite link is invalid or has already been used."
    ),
    "Ссылка тревоги недействительна.": "The panic link is invalid.",
    "Ссылка уже отозвана.": "The link has already been revoked.",
    "Ссылку не удалось разобрать": "Could not parse the link",
    "Текущий пароль указан неверно.": "The current password is wrong.",
    "Устройство вышло из аккаунта.": "The device has been signed out.",
    "У этого номера уже есть пароль. Войдите с ним.": (
        "This number already has a password. Sign in with it."
    ),
    "Это приглашение выдано для другого номера телефона.": (
        "This invitation was issued for another phone number."
    ),
    "Этот e-mail уже привязан к другому аккаунту.": (
        "This e-mail is already linked to another account."
    ),
    # Журнал безопасности: так описываются события (видны человеку в профиле).
    "адрес e-mail подтверждён кодом из письма": (
        "e-mail address confirmed with a code from the letter"
    ),
    "аккаунт разморожен по коду из письма": (
        "account unfrozen with a code from the letter"
    ),
    "аккаунт удалён пользователем": "account deleted by the user",
    "вход по коду из письма": "signed in with a code from the letter",
    "вход по коду на телефон": "signed in with a code sent to the phone",
    "вход по паролю": "signed in with a password",
    "вход по паролю: неверный номер или пароль": (
        "sign-in with a password: wrong phone number or password"
    ),
    "вход с нового устройства подтверждён кодом из письма": (
        "sign-in from a new device confirmed with a code from the letter"
    ),
    "выход из приложения на этом устройстве": "signed out of the app on this device",
    "выход на всех устройствах": "signed out on all devices",
    "код подтверждения запрошен на номер аккаунта": (
        "a confirmation code was requested to the account phone number"
    ),
    "новое устройство без 2FA: подтверждённого e-mail нет": (
        "new device without 2FA: no confirmed e-mail"
    ),
    "пароль восстановлен по коду из письма, старые сессии отозваны": (
        "password restored with a code from the letter, old sessions revoked"
    ),
    "пароль изменён, старые сессии отозваны": (
        "password changed, old sessions revoked"
    ),
    "публичный ключ шифрования устройства заменён": (
        "the device's public encryption key was replaced"
    ),
    # --- Напоминания, истории, стикеры, файлы ---
    "Время напоминания должно быть в будущем": (
        "The reminder time must be in the future"
    ),
    "Время отправки должно быть в будущем": "The sending time must be in the future",
    "История может быть фото или видео": "A story can be a photo or a video",
    "Напомнить можно не дальше чем через год": (
        "A reminder can be set no further than a year ahead"
    ),
    "На свою историю реагировать нельзя": "You cannot react to your own story",
    "Отложить можно не дальше чем на 30 дней": (
        "A message can be scheduled no further than 30 days ahead"
    ),
    "Предложение уже рассмотрено": "The suggestion has already been reviewed",
    "Пустой файл": "Empty file",
    "Содержимое файла не похоже на изображение": (
        "The file content does not look like an image"
    ),
    "Не удалось прочитать фото HEIC — выберите другое": (
        "Could not read the HEIC photo — try another one"
    ),
    "Стикер не может быть одноразовым": "A sticker cannot be view-once",
    "Стикер — это PNG, WebP или GIF": "A sticker is a PNG, WebP or GIF image",
    "Стикер — это картинка": "A sticker is an image",
    "Такой набор уже добавлен": "This set has already been added",
    "Такой реакции нет в наборе": "There is no such reaction in the set",
    "Файл повреждён": "The file is corrupted",
    "Недопустимый адрес GIF": "Invalid GIF address",
    "Недопустимый тип файла": "Invalid file type",
    "Недопустимый формат файла": "Invalid file format",
    "Недопустимая роль": "Invalid role",
    "Сервис обработки GIF временно недоступен. Попробуйте позже.": (
        "The GIF service is temporarily unavailable. Try again later."
    ),
    "Ни одно из устройств получателей не зарегистрировано": (
        "None of the recipients' devices are registered"
    ),
    "Не удалось сохранить подписку.": "Could not save the subscription.",
    "Один из пользователей не найден": "One of the users was not found",
    # --- Ограничение частоты ---
    "На сегодня письма с кодами не отправляются. Попробуйте завтра.": (
        "Letters with codes are not sent today. Try again tomorrow."
    ),
    "Слишком много групп. Попробуйте позже.": "Too many groups. Try again later.",
    "Слишком много жалоб. Попробуйте позже.": "Too many reports. Try again later.",
    "Слишком много загрузок. Попробуйте позже.": ("Too many uploads. Try again later."),
    "Слишком много запросов. Попробуйте позже.": (
        "Too many requests. Try again later."
    ),
    "Слишком много неверных кодов. Запросите новый.": (
        "Too many wrong codes. Request a new one."
    ),
    "Слишком много неверных попыток. Запросите новый код.": (
        "Too many wrong attempts. Request a new code."
    ),
    "Слишком много новых историй за минуту. Попробуйте позже.": (
        "Too many new stories in a minute. Try again later."
    ),
    "Слишком много писем на этот адрес за час. Попробуйте позже.": (
        "Too many letters to this address within an hour. Try again later."
    ),
    "Слишком много просмотров за минуту. Попробуйте позже.": (
        "Too many views in a minute. Try again later."
    ),
    "Слишком много реакций за минуту. Попробуйте позже.": (
        "Too many reactions in a minute. Try again later."
    ),
    "Слишком много ссылок за минуту. Попробуйте позже.": (
        "Too many links in a minute. Try again later."
    ),
    # --- Служебные (внутренние) ошибки ---
    "Не удалось загрузить группу": "Could not load the group",
    "Не удалось загрузить сообщение": "Could not load the message",
    "Не удалось обновить группу": "Could not update the group",
    "Не удалось создать группу": "Could not create the group",
    # --- Тексты с подстановками (f-строки в исходниках) ---
    "В наборе уже {max} стикеров — создайте новый": (
        "The set already has {max} stickers — create a new one"
    ),
    "Больше {max} наборов не помещается — удалите лишний": (
        "No more than {max} sets fit — delete one"
    ),
    "Стикер слишком большой (максимум {kb} КБ)": (
        "The sticker is too large (maximum {kb} KB)"
    ),
    "Код отправлен на {email}.": "The code has been sent to {email}.",
    "Код уже отправлен. Повторите через {seconds} секунд.": (
        "The code has already been sent. Try again in {seconds} seconds."
    ),
    "Код уже отправлен. Повторите запрос через {seconds} секунд.": (
        "The code has already been sent. Repeat the request in {seconds} seconds."
    ),
    "неверные учётные данные (логин/номер: {login})": (
        "wrong credentials (username/phone: {login})"
    ),
    "блокировка перебора активна ещё {seconds} с": (
        "the brute-force lock is active for {seconds} s more"
    ),
    "завершён вход с устройства (сессия #{id})": (
        "sign-in from the device finished (session #{id})"
    ),
    "адрес изменён на {value}": "address changed to {value}",
    "удалён": "deleted",
    "новое устройство, код отправлен на {email}": "new device, code sent to {email}",
    "код на {email}: {code}": "code to {email}: {code}",
    "тревога ({source}): сессии отозваны": "panic ({source}): sessions revoked",
    "В альбоме не больше {max} вложений": (
        "An album holds no more than {max} attachments"
    ),
    "Файл слишком большой (максимум {mb} МБ)": (
        "The file is too large (maximum {mb} MB)"
    ),
    "Для подтверждения введите {code}": "Enter {code} to confirm",
    "все входы завершены поддержкой (модератор {id})": (
        "all sessions ended by support (moderator {id})"
    ),
    "аккаунт заморожен поддержкой (модератор {id})": (
        "account frozen by support (moderator {id})"
    ),
    "аккаунт разморожен поддержкой (модератор {id})": (
        "account unfrozen by support (moderator {id})"
    ),
    "Вы в муте ещё примерно {minutes} мин": (
        "You are muted for about {minutes} min more"
    ),
    "Медленный режим: подождите {seconds} с": "Slow mode: wait {seconds} s",
    "Лимит: не больше {limit} каналов на аккаунт": (
        "Limit: no more than {limit} channels per account"
    ),
    # --- Уведомления (push): тексты читает ПОЛУЧАТЕЛЬ ---
    "Новое сообщение": "New message",
    "🔒 Вложение защищено сквозным шифрованием": (
        "🔒 The attachment is protected by end-to-end encryption"
    ),
    "🔒 Сообщение защищено сквозным шифрованием": (
        "🔒 The message is protected by end-to-end encryption"
    ),
    "Вложение: {name}": "Attachment: {name}",
    "{title}: вас упомянули": "{title}: you were mentioned",
    "Напоминание": "Reminder",
    "Чат": "Chat",
    "Сохранённые сообщения": "Saved messages",
    "Сообщение в чате «{label}»": "A message in the chat “{label}”",
    "Чат «{label}»": "Chat “{label}”",
    "Чат «{label}»: {what}": "Chat “{label}”: {what}",
    # --- Письма и push о безопасности ---
    "Pismo: пароль изменён": "Pismo: password changed",
    "Pismo: доступ восстановлен по e-mail": "Pismo: access restored by e-mail",
    "Pismo: выполнен выход на всех устройствах": ("Pismo: signed out on all devices"),
    "Pismo: адрес e-mail в аккаунте изменён": "Pismo: account e-mail address changed",
    "Pismo: вход с нового устройства": "Pismo: sign-in from a new device",
    "Pismo: аккаунт заморожен": "Pismo: account frozen",
    "Pismo: аккаунт разморожен": "Pismo: account unfrozen",
    "Pismo: сработала тревога «это были не я»": "Pismo: the “it was not me” panic fired",
    "Pismo: ключ шифрования устройства изменён": (
        "Pismo: the device encryption key was changed"
    ),
    "Если это были не вы — сразу смените пароль в приложении (Профиль → Безопасность), нажмите «Выйти на всех устройствах» и напишите на nyuskov@gmail.com.": (
        "If this was not you, change the password in the app right away "
        "(Profile → Security), tap “Sign out on all devices” and write to "
        "nyuskov@gmail.com."
    ),
    "— Pismo, автоматическое уведомление о безопасности": (
        "— Pismo, an automatic security notification"
    ),
    "Время: {time}": "Time: {time}",
    "из приложения": "from the app",
    "поддержкой": "by support",
    "Аккаунт заморожен {where}: все устройства вышли, вход закрыт.\nРазморозить можно кодом из письма (Профиль → Безопасность или экран входа).": (
        "The account was frozen {where}: all devices have been signed out and "
        "sign-in is closed.\nTo unfreeze, use the code from the letter "
        "(Profile → Security or the sign-in screen)."
    ),
    "Аккаунт снова активен. Если это были не вы — смените пароль.": (
        "The account is active again. If this was not you, change the password."
    ),
    "Устройство: {device}\nIP-адрес: {ip}\nВход выполнен успешно.": (
        "Device: {device}\nIP address: {ip}\nSigned in successfully."
    ),
    "неизвестен": "unknown",
    "IP неизвестен": "IP unknown",
    "Новый вход в аккаунт": "New sign-in to the account",
    "{device} · {ip}. Если это не вы — нажмите «Это не я».": (
        "{device} · {ip}. If this was not you, tap “This was not me”."
    ),
    "Прежний адрес: {old}\nНовый адрес: {new}": (
        "Previous address: {old}\nNew address: {new}"
    ),
    "адрес удалён": "the address was removed",
    # --- Письма с кодами (язык владельца аккаунта) ---
    "Pismo: код подтверждения": "Pismo: confirmation code",
    "Pismo: код входа {code}. Никому не сообщайте код.": (
        "Pismo: sign-in code {code}. Do not share the code with anyone."
    ),
    "Если адрес привязан к аккаунту, письмо с кодом отправлено.": (
        "If the address is linked to an account, a letter with the code has been sent."
    ),
    "Вход с нового устройства. Мы отправили код на вашу почту — введите его, чтобы подтвердить этот вход.": (
        "Sign-in from a new device. We have sent a code to your e-mail — enter "
        "it to confirm this sign-in."
    ),
    "Подтверждение входа в Pismo с нового устройства.\nУстройство: {device}": (
        "Confirmation of a sign-in to Pismo from a new device.\nDevice: {device}"
    ),
    "Подтверждение адреса e-mail в Pismo.": "Confirming the e-mail address in Pismo.",
    "Вход в Pismo по коду из письма.": "Signing in to Pismo with a code from the letter.",
    "Сброс пароля Pismo.": "Resetting the Pismo password.",
    "Разморозка аккаунта Pismo.": "Unfreezing the Pismo account.",
    "Код: {code}": "Code: {code}",
    "Код действует {minutes} мин.\nЕсли вы не запрашивали код, просто игнорируйте это письмо.": (
        "The code is valid for {minutes} min.\nIf you did not request the code, "
        "just ignore this letter."
    ),
    "Аккаунт заморожен. Восстановите доступ по коду из письма — или напишите в поддержку: nyuskov@gmail.com.": (
        "The account is frozen. Restore access with the code from the letter — "
        "or write to support: nyuskov@gmail.com."
    ),
    "Сессия завершена: выполнен выход на всех устройствах или изменён пароль. Войдите заново.": (
        "The session has ended: all devices were signed out or the password was "
        "changed. Sign in again."
    ),
    "Пароль изменён, остальные устройства вышли из аккаунта.\nIP-адрес: {ip}": (
        "The password was changed and the other devices were signed out.\n"
        "IP address: {ip}"
    ),
    "Пароль восстановлен по коду из письма, прежние сессии отозваны.\nIP-адрес: {ip}": (
        "The password was restored with the code from the letter and the previous "
        "sessions were revoked.\nIP address: {ip}"
    ),
    "Слишком много неверных попыток входа. Повторите через {seconds} сек.": (
        "Too many wrong sign-in attempts. Try again in {seconds} s."
    ),
    # --- Письма модерации ---
    "спам или реклама": "spam or advertising",
    "оскорбления или угрозы": "insults or threats",
    "мошенничество": "fraud",
    "насилие или шок-контент": "violence or shock content",
    "другое нарушение": "another violation",
    "новая": "new",
    "в работе": "in review",
    "нарушение подтверждено": "the violation was confirmed",
    "нарушение не подтверждено": "the violation was not confirmed",
    "Pismo: жалоба рассмотрена": "Pismo: your report has been reviewed",
    "Pismo: сообщение скрыто до проверки": (
        "Pismo: the message is hidden until a review"
    ),
    "Ваша жалоба в Pismo рассмотрена.": "Your report in Pismo has been reviewed.",
    "Причина обращения: {reason}": "Reason for the report: {reason}",
    "Решение: {status}": "Decision: {status}",
    "Комментарий модератора: {note}": "Moderator's comment: {note}",
    "Спасибо, что помогаете делать Pismo безопаснее.": (
        "Thank you for helping make Pismo safer."
    ),
    "— Pismo, уведомление модерации": "— Pismo, a moderation notice",
    "Ваше сообщение скрыто до проверки модератором.": (
        "Your message is hidden until a moderator reviews it."
    ),
    "Сообщение: «{preview}»": "Message: “{preview}”",
    "Жалоб от разных пользователей: {reports}": (
        "Reports from different users: {reports}"
    ),
    "Скрытое сообщение видите только вы. Если это ошибка — напишите на": (
        "Only you can see the hidden message. If this is a mistake, write to"
    ),
    "nyuskov@gmail.com или отредактируйте сообщение.": (
        "nyuskov@gmail.com or edit the message."
    ),
    "вложение": "attachment",
    "Этот формат видео не проигрывается в браузере, и перекодировать его не удалось. Выберите другой файл.": (
        "This video format does not play in the browser and could not be "
        "transcoded. Choose another file."
    ),
    # --- Кнопки уведомлений и звонки ---
    "Входящий звонок": "Incoming call",
    "Всё ещё звонит": "Still ringing",
    "Видеозвонок": "Video call",
    "Аудиозвонок": "Voice call",
    "Пользователь": "User",
    "Открыть": "Open",
    "Ответить": "Reply",
    "Пометить как прочитанное": "Mark as read",
    "Это не я": "This was not me",
}
