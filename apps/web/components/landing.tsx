"use client";
import { ArrowUpRight, Download, LockKeyhole } from "../../../packages/design/ui-icons";
import { Halo, PileCat, Wordmark, BrandIllustration } from "./brand";
import { brandCopy } from "../../../packages/design/copy";

const repositoryUrl = "https://github.com/hammersmithg1/doompile";
const quickStartUrl = `${repositoryUrl}/blob/main/docs/get-started.md`;
const selfHostUrl = `${quickStartUrl}#свой-сервер`;
const macDownloadUrl = "https://doompile.space/doompile/downloads/macos/latest.zip";

export default function Landing({
  configuration,
}: {
  configuration: {
    providers: { id: string; enabled: boolean }[];
    development: boolean;
  };
}) {
  const returnTo =
    typeof window === "undefined" ? "/" : location.pathname + location.search;
  const failed =
    typeof window !== "undefined" &&
    new URLSearchParams(location.search).has("auth_error");
  return (
    <main className="landing">
      <header className="landing-header">
        <a href="/" className="landing-brand">
          <Wordmark />
          <Halo />
        </a>
        <nav className="landing-links" aria-label="О проекте">
          <a href={quickStartUrl}>Быстрый старт</a>
          <a href={repositoryUrl}>
            Код на GitHub <ArrowUpRight size={14} />
          </a>
        </nav>
      </header>
      <div className="landing-main">
        <section className="landing-copy">
          <span className="eyebrow">ОТКРЫТЫЙ КОД · MIT</span>
          <h1>
            {brandCopy.capture}
            <br />
            <em>{brandCopy.forget}</em>
          </h1>
          <p>
            Собирай мысли, ссылки, цитаты и голосовые заметки в одном месте.
            Пользуйся готовым облаком Doompile или разверни свой сервер.
          </p>
          <div className="landing-actions">
            <a className="landing-action-primary" href="#sign-in">
              Начать в браузере
            </a>
            <a href={macDownloadUrl}>
              Скачать для Mac <Download size={16} />
            </a>
            <a href={selfHostUrl}>
              Развернуть у себя <ArrowUpRight size={16} />
            </a>
          </div>
          <div className="landing-void">
            <BrandIllustration kind="void" />
            <span>{brandCopy.aside}</span>
          </div>
        </section>
        <section
          className="landing-login"
          id="sign-in"
          aria-labelledby="login-title"
          tabIndex={-1}
        >
          <span className="eyebrow">ВЕБ-ВЕРСИЯ</span>
          <h2 id="login-title">Заходи. Сохраняй.</h2>
          <p>
            Войди, чтобы заметки были рядом
            <br />
            на всех твоих устройствах.
          </p>
          <div className="oauth-buttons">
            {configuration.providers.map((provider) =>
              provider.enabled ? (
                <a
                  key={provider.id}
                  className={`oauth-button ${provider.id}`}
                  href={`/api/auth/${provider.id}?returnTo=${encodeURIComponent(returnTo)}`}
                >
                  <b aria-hidden="true">
                    {provider.id === "yandex" ? "Я" : "G"}
                  </b>
                  Войти через {provider.id === "yandex" ? "Яндекс" : "Google"}
                  <ArrowUpRight size={18} />
                </a>
              ) : (
                <button className="oauth-button" key={provider.id} disabled>
                  <b aria-hidden="true">
                    {provider.id === "yandex" ? "Я" : "G"}
                  </b>
                  {provider.id === "yandex" ? "Яндекс" : "Google"}
                  <small>Недоступно</small>
                </button>
              ),
            )}
          </div>
          {failed && (
            <p className="form-error" role="alert">
              Вход не завершён. Попробуй ещё раз.
            </p>
          )}
          {!configuration.development &&
            !configuration.providers.some((p) => p.enabled) && (
              <p className="landing-pending">
                Для входа <a href={selfHostUrl}>настрой OAuth</a> на сервере.
              </p>
            )}
          {configuration.development && (
            <form method="post" action="/api/auth/development">
              <button className="quiet-button">
                Локальный тестовый аккаунт ↗
              </button>
            </form>
          )}
          <div className="landing-private">
            <LockKeyhole size={15} />
            <span>Твои заметки видны только тебе.</span>
          </div>
        </section>
      </div>
      <footer className="landing-footer">
        <span>{brandCopy.motto}</span>
        <div className="landing-cat">
          <PileCat />
        </div>
        <a href={`${quickStartUrl}#клиенты`}>Приложения и расширения</a>
      </footer>
    </main>
  );
}
