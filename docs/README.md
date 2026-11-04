# Документы проекта — индекс

Начните с [../README.md](../README.md): что это за проект, стек, запуск. Здесь —
карта остального: что искать в каком файле. Файлы лежат плоско, потому что
документов немного; группы ниже — «по ролям».

## Эксплуатация (прод)

| Документ | О чём |
| --- | --- |
| [production.md](production.md) | как выкатывается прод, что за сервисы, blue/green, без простоя |
| [monitoring.md](monitoring.md) | проверка прода каждые 15 минут, оповещения |
| [local-backup.md](local-backup.md) | бэкап прода на свою машину (БД + media) по cron |
| [offsite-backup.md](offsite-backup.md) | выгрузка бэкапов в облако (rclone) |
| [email-smtp.md](email-smtp.md) | почта: SMTP для писем/уведомлений |
| [turn.md](turn.md) | TURN для WebRTC-звонков |
| [jwt-rotation.md](jwt-rotation.md) | ротация JWT-ключа без разлогина всех |
| [at-rest-rotation.md](at-rest-rotation.md) | ротация ключа шифрования «в покое» (тексты + файлы) |

## Разработка

| Документ | О чём |
| --- | --- |
| [backend.md](backend.md) | бэкенд: модули, модели, API, миграции |
| [frontend.md](frontend.md) | фронтенд: сборка, компоненты, PWA, шрифты |
| [design-system.md](design-system.md) | геометрия (радиусы/отступы/движение) и чем открывать окно: модалка, лист, панель, полный экран |
| [on-device-transcription.md](on-device-transcription.md) | расшифровка голосовых на устройстве: три пути распознавания, свои ассеты в `/stt/`, CSP и как их обновить |
| [gotchas.md](gotchas.md) | правила и «грабли» — короткий список на все случаи |
| [checks.md](checks.md) | свои проверки: что делают, когда запускаются, как обновить базу |
| [feed-performance.md](feed-performance.md) | замеры ленты сообщений и решение по виртуализации |
| [refactoring.md](refactoring.md) | план улучшений по коду и структуре репозитория |
| [public-release.md](public-release.md) | публикация репозитория в open source: что обезличено и что проверить |

## Планы и предложения

| Документ | О чём |
| --- | --- |
| [roadmap.md](roadmap.md) | план развития |
| [feature-proposals.md](feature-proposals.md) | предложения по функциям (с оценкой) |
| [drafts.md](drafts.md) | черновики и разрозненные мысли |
| [stories.md](stories.md) | истории (что уже сделано и как устроено) |
| [links-share-preview.md](links-share-preview.md) | превью ссылок и шеринг |

## Публикация и юридическое

| Документ | О чём |
| --- | --- |
| [rustore.md](rustore.md) | Android-приложение: сборка и публикация в RuStore |
| [privacy-policy.md](privacy-policy.md), [terms-of-service.md](terms-of-service.md), [community-guidelines.md](community-guidelines.md) | пользовательские документы (те же тексты лежат страницами в `frontend/public/*.html`) |
| [rkn-notification.md](rkn-notification.md), [rkn-checklist.md](rkn-checklist.md), [pd-internal-documents.md](pd-internal-documents.md) | РКН и персональные данные |

## История

| Документ | О чём |
| --- | --- |
| [changelog.md](changelog.md) | что и когда делалось — с числами и причинами |

## Правила для этого каталога

- Один документ — одна тема; если файл разрастается, делим по смыслу, а не по дате.
- Документ для пользователя (то, что читают в приложении) живёт ещё и страницей в
  `frontend/public/`; правки синхронизируем вручную.
- Ссылки внутри `docs/` — относительные (`gotchas.md`), из корня — через `docs/`.
- Для новых документов добавляйте строку в этот индекс: он и есть карта каталога.
