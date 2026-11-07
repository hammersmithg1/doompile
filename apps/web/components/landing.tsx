"use client";
import { ArrowUpRight, LockKeyhole } from "../../../packages/design/ui-icons";
import { Halo, PileCat, Wordmark, BrandIllustration } from "./brand";
import { brandCopy } from "../../../packages/design/copy";
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
        <span>{brandCopy.empty}</span>
      </header>
      <div className="landing-main">
        <section className="landing-copy">
          <span className="eyebrow">{brandCopy.tagline}</span>
          <h1>
            {brandCopy.capture}
            <br />
            <em>{brandCopy.forget}</em>
          </h1>
          <p>
            Мысль, ссылка, цитата или голосовая заметка.
            <br className="landing-break" /> Сохрани сейчас. Разберёшься потом.
          </p>
          <div className="landing-void">
            <BrandIllustration kind="void" />
            <span>{brandCopy.aside}</span>
          </div>
        </section>
        <section className="landing-login" aria-labelledby="login-title">
          <span className="eyebrow">ТВОЯ ЛИЧНАЯ КУЧА</span>
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
                  <small>Скоро</small>
                </button>
              ),
            )}
          </div>
          {failed && (
            <p className="form-error" role="alert">
              Вход не завершён. Попробуй ещё раз.
            </p>
          )}
          {!configuration.providers.some((p) => p.enabled) && (
            <p className="landing-pending">
              Вход скоро откроется — подключаем аккаунты.
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
        <span>МАЛЕНЬКОЕ МЕСТО ДЛЯ БОЛЬШИХ «ПОТОМ»</span>
      </footer>
    </main>
  );
}
