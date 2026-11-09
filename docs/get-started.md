# Быстрый старт Doompile

## Облако

Открой [облачный Doompile](https://grudin.me/doompile), войди в браузере и сохрани первую заметку. В приложениях и расширении используй тот же способ входа, чтобы открыть ту же коллекцию.

## Свой сервер

Для запуска понадобятся Linux-сервер с Git, Docker Compose и OpenSSL, домен с HTTPS и OAuth-клиент Яндекса или Google. Контейнер приложения хранит заметки в SQLite, а вложения — в приватном MinIO. Compose собирает оба образа из этого репозитория.

### Подготовь сервер

~~~sh
git clone https://github.com/hammersmithg1/doompile.git
cd doompile
mkdir -p runtime/self-host/downloads/macos
sudo install -d -o 1000 -g 1000 -m 0750 runtime/self-host/data runtime/self-host/s3

umask 077
(
  set -C
  cat > .env <<EOF
DOOMPILE_PUBLIC_URL=https://notes.example.org
DOOMPILE_COMPOSE_PROJECT=doompile-self-host
DOOMPILE_DATA_PATH=../runtime/self-host/data
DOOMPILE_S3_DATA_PATH=../runtime/self-host/s3
DOOMPILE_MACOS_RELEASES_PATH=../runtime/self-host/downloads/macos
DOOMPILE_S3_ACCESS_KEY=doompile
DOOMPILE_S3_SECRET_KEY=$(openssl rand -hex 32)
EOF
)
~~~

Замени `https://notes.example.org` на адрес своего сервера без `/doompile`. Файл `.env` предназначен для сервера и исключён из Git. Настройки можно передать через окружение или менеджер секретов.

### Подключи вход

Зарегистрируй у провайдера OAuth-клиент для веб-приложения. Используй свой домен в адресе возврата и добавь пару значений для выбранного провайдера в серверное окружение или `.env`.

| Провайдер | Адрес возврата | Переменные |
| --- | --- | --- |
| Яндекс | `https://notes.example.org/api/auth/yandex/callback` | `DOOMPILE_YANDEX_CLIENT_ID`, `DOOMPILE_YANDEX_CLIENT_SECRET` |
| Google | `https://notes.example.org/api/auth/google/callback` | `DOOMPILE_GOOGLE_CLIENT_ID`, `DOOMPILE_GOOGLE_CLIENT_SECRET` |

Разрешения OAuth и настройки аккаунтов описаны отдельно. [Настройка входа](authentication.md#яндекс-и-google)

### Запусти Doompile

~~~sh
docker compose --env-file .env -f infra/compose.yml up -d --build --wait
~~~

Направь домен на сервер, открой порты 80 и 443 и настрой HTTPS-прокси к `127.0.0.1:3102`. Если используешь Caddy на сервере, добавь этот блок в Caddyfile. [Руководство Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy)

~~~caddyfile
notes.example.org {
    reverse_proxy 127.0.0.1:3102
}
~~~

Проверь `https://notes.example.org/api/health` и открой `https://notes.example.org/doompile`. В клиентах открой **Своя конфигурация**, введи свой домен и подтверди вход в браузере. Данные сохраняются в `runtime/self-host` при пересоздании контейнеров. Для staging, обновлений и проверяемых бэкапов см. [эксплуатацию сервера](server-operations.md).

## Локальный запуск

Для знакомства с вебом на своём компьютере установи [mise](https://mise.jdx.dev/) и выполни команды из корня репозитория.

~~~sh
mise install
mise exec -- npm ci
DOOMPILE_STORAGE=filesystem DOOMPILE_DEV_LOGIN=1 \
  mise exec -- npm run dev -- --hostname 127.0.0.1
~~~

Открой [localhost:3000](http://localhost:3000) и нажми **Локальный тестовый аккаунт**. Этот режим использует локальные файлы и тестовый вход.

## Клиенты

- **Веб** открывается по адресу `/doompile`.
- **iPhone и Mac** подключаются по адресу сервера без `/doompile`. В настройках выбери **Войти через браузер**. [iPhone](../apps/ios/README.md) · [Mac](../apps/macos/README.md)
- **Web Clipper** сохраняет выделения и ссылки из браузера. [Установка и подключение](../extensions/clipper/README.md)
