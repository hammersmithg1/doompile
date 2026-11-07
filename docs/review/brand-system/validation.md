# Doompile · внедрение системы бренда · 1 ноября 2026

Исходники системы: [packages/design](../../../packages/design). Правила: [system.md](../../design/system.md). Визуальный каталог: [preview.html](../../design/preview.html).

## Изменения

- Английские брендовые реплики отделены от русского интерфейса в общем реестре. Переведены собственные сообщения, настройки и подписи доступности Apple-клиентов и расширения.
- Общий векторный wordmark Sora, знак стопки с нимбом, оптическая монохромная версия для Safari/системных действий.
- 56 векторных пиктограмм с русскими доступными названиями; геометрия общая для React, DOM-редактора, клиппера и Apple asset catalog. Закрепление обозначается булавкой.
- Три прозрачные коллажные иллюстрации: pile, void, cat. Исходники и промпты сохранены в проекте.
- Размеры app icons и PWA, Action Extension, нативные ресурсы и цвета запуска генерируются из общего источника. macOS больше не смешивает размеры из iOS и clipper.
- Проверка 238 экспортов и правил языка/иконок включена в `shared:check`, который запускается существующими web и native CI.

## Проверки

- `npm run shared:check` — проходит; сравнивает текстовые и бинарные экспорты с источниками и проверяет правила.
- `npm run typecheck` — проходит.
- `npm test` — 168 проходят, 1 необязательный тест реального S3 пропущен.
- `DOOMPILE_CLIPPER_ISOLATED_TEST=1 ... playwright ... extensions/clipper/playwright.config.mjs` — 18 сценариев проходят на desktop/iPhone WebKit. Тестовый аккаунт изолирован от настоящих данных.
- `DOOMPILE_BUILD_DIR=.next-brand-verify npm run build` — production-сборка web проходит.
- `xcodebuild ... generic/platform=iOS Simulator ... CODE_SIGNING_ALLOWED=NO build` — приложение, Share, Action и Safari Extensions собираются.
- `xcodebuild ... generic/platform=macOS ... CODE_SIGNING_ALLOWED=NO build` — приложение и Safari Extension собираются.
- Дополнительная изолированная проверка компонента клиппера в Chrome и iPhone WebKit: комментарий → раскрытие → закрепление → передача документа при сохранении; черновик и флаг сохранены.
- Desktop/mobile web проверен на отдельных демоданных: пустой и заполненный экран, обе темы, страница входа, отсутствие горизонтального переполнения, сохранение новой записи. API перехватывался до открытия страницы.

## Снимки

- [Desktop, пустая коллекция](desktop-empty-light.png)
- [Desktop, светлая тема](desktop-feed-light.png)
- [Desktop, тёмная тема](desktop-feed-dark.png)
- [Mobile, пустая коллекция](mobile-empty-light.png)
- [Mobile, тёмная тема](mobile-feed-dark.png)
- [Страница входа](landing-light.png)
- [Изолированный компонент клиппера, desktop](clipper-desktop-light.png)
- [Изолированный компонент клиппера, 390 px / WebKit](clipper-mobile-dark.png)
- [Набор ассетов, светлая тема](asset-gallery-light.png)
- [Набор ассетов, тёмная тема](asset-gallery-dark.png)

Нативные проверки в этом раунде — сборки, без нового UI-прогона на устройстве. Приложения не устанавливались пользователю, в TestFlight не загружались, работающая временная папка Safari не перезаписывалась.
