# Android-приложение Pismo (оболочка для RuStore)

Нативное Android-приложение — это WebView с тем же веб-клиентом, что и PWA
(`https://pismo.space`). Поэтому веб-версия и приложение всегда синхронны, а
нативный слой отвечает за то, чего нет в браузере:

| Что | Где |
|---|---|
| WebView, разрешения (камера/микрофон), выбор файлов, «назад», экран «нет сети» | `app/src/main/java/space/pismo/app/MainActivity.java` |
| Push-уведомления RuStore (токен, приём, каналы) | `App.java`, `PismoMessagingService.java`, `PushChannels.java` |
| Мост в веб-страницу (DOM-события `pismo:*`, `window.PismoNative`) | `WebBridge.java` |
| Иконки, adaptive-иконка, сплэш, иконка уведомлений | `app/src/main/res/**` (генерируются скриптом) |

Ссылки и «Поделиться»:

* **App Links**: ссылки `https://pismo.space/...` (в т.ч. `…/u/<логин>`) открываются
  в приложении — проверка владения доменом идёт по
  `https://pismo.space/.well-known/assetlinks.json` (отпечаток подписи —
  `scripts/rustore/cert_fingerprint.sh`);
* **приём «Поделиться»** (`ACTION_SEND`, `text/plain` и `image/*`): Pismo есть в
  системном списке «Поделиться»; содержимое уходит на страницу событием
  `pismo:share`, байты файла страница забирает по частям
  (`PismoNative.readShareChunk`), дальше — выбор чата в вебе
  (`frontend/src/services/nativeShare.ts`). Подробности — `docs/links-share-preview.md`;

Расшифровка голосовых (`SpeechFileRecognizer.java`):

* в WebView API распознавания речи НЕТ (Web Speech — возможность браузера
  Chrome, а не движка WebView), поэтому кнопка «В текст» без нативной части не
  работала бы вообще;
* страница декодирует запись и присылает «сырой» PCM 16 бит, моно, 16 кГц в base64
  кусками (`PismoNative.speechBegin/speechChunk`, ~6 с звука на вызов): сам
  распознаватель контейнеров (wav/ogg) не понимает, а одному вызову большой файл
  не пролезет;
* нативная часть пишет звук во временный файл и отдаёт его системному
  распознавателю как источник ({@code EXTRA_AUDIO_SOURCE}, нужен Android 13+),
  сначала «на устройстве» (без сети), иначе — обычному системному;
* результат приходит странице событием `pismo:speech` (`partial` — текст по мере
  чтения, `ready`/`failed` — итог), отмена — `PismoNative.speechCancel`;
* временный файл удаляется после расшифровки, отмены или выхода из приложения.

Ключевые параметры: `space.pismo.app`, minSdk 26 (Android 8), targetSdk 35,
версия и адрес приложения — в `gradle.properties`.

## Сборка

JDK и Android SDK на хост ставить не нужно — сборка идёт в Docker-образе
(`android/Dockerfile.build`: JDK 17 + Android SDK 35 + Gradle 8.9).

```bash
# из корня репозитория
./scripts/rustore/build_android.sh assembleDebug     # debug APK (проверка)
./scripts/rustore/build_android.sh bundleRelease     # AAB для RuStore
./scripts/rustore/build_android.sh assembleRelease   # подписанный APK
```

Артефакты: `android/app/build/outputs/{apk,bundle}/…`.

Переопределяемые параметры (пробрасываются в Gradle):

```bash
./scripts/rustore/build_android.sh bundleRelease \
  -PrustoreProjectId=123456 \      # ID проекта push (RuStore Консоль)
  -PpismoVersionCode=2 \           # обязательно увеличивать при публикации
  -PpismoVersionName=1.1.0
```

Такие же значения можно задать в `android/gradle.properties`.

## Подпись

```bash
./scripts/rustore/new_keystore.sh      # создаст android/keystore/pismo-release.jks
# затем заполните android/keystore.properties (образец — keystore.properties.example)
./scripts/rustore/cert_fingerprint.sh  # SHA-256 отпечаток (для assetlinks.json)
./scripts/rustore/write_assetlinks.sh  # пропишет отпечаток в frontend/public/.well-known/
```

`keystore.properties`, `keystore/` и `*.jks` в git не попадают. Храните ключ и
пароли в надёжном месте: без них нельзя выпустить обновление с той же подписью.

## Локальная сборка в Android Studio

`gradlew` в репозитории есть, поэтому в Android Studio проект открывается как
обычный Gradle-проект — нужны только JDK 17 и Android SDK 35 (или `local.properties`
с `sdk.dir`).

## Что проверить на устройстве

- вход по номеру/паролю и загрузка чатов;
- разрешения камеры/микрофона при звонке и записи голосового;
- выбор файла из галереи при отправке вложения;
- push-уведомление о сообщении и о звонке (RuStore установлен, пользователь
  авторизован в RuStore — см. `docs/rustore.md`);
- клик по уведомлению открывает нужный чат;
- «назад» закрывает модалки/возвращает к списку чатов, а не сразу выходит;
- «Поделиться» из браузера/галереи: Pismo есть в списке, после выбора чата
  приходит ссылка/текст или картинка;
- ссылка `https://pismo.space/u/<логин>` открывает чат с этим человеком (стать
  ссылкой можно из профиля: «Моя ссылка»);
- при клике по чужой ссылке сначала показывается предупреждение о переходе,
  и только после «Перейти» открывается системный браузер.- расшифровка голосового в текст (Android 13+): кнопка «В текст» под голосовым,
  текст появляется по мере распознавания; если язык не тот — переключается рядом
  с текстом, а не в настройках.
Если push не приходят, частая причина — пустой `rustoreProjectId` при сборке
(`-PrustoreProjectId=…`) или аккаунт не авторизован в RuStore.
