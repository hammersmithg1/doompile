"use client";
import { useEffect, useState } from "react";
import { exportDiagnostics, setTelemetryEnabled, track, webTelemetry } from "@/lib/client/telemetry";
import { useAccount } from "./account-gate";
import { accountFetch, forgetAccount } from "@/lib/client/account";
import { notePath } from "@doompile/core";
import {
  X,
  RefreshCw,
  Monitor,
  Sun,
  Moon,
  Download,
  Link2,
  LogOut,
} from "../../../packages/design/ui-icons";
import type { AppearanceMode } from "@/lib/client/appearance";
import * as store from "@/lib/client/store";
import { showCommandPreferences } from "../../../packages/editor/src/command-preferences";
import Modal from "./modal";
import { Halo, Wordmark } from "./brand";
import { brandCopy } from "../../../packages/design/copy";
export default function SettingsDialog({
  state,
  theme,
  setTheme,
  onClose,
  onHelp,
  notify,
}: {
  state: ReturnType<typeof store.getSnapshot>;
  theme: AppearanceMode | null;
  setTheme: (theme: AppearanceMode) => void;
  onClose: () => void;
  onHelp: () => void;
  notify: (message: string) => void;
}) {
  const account = useAccount();
  const [telemetryEnabled, setSending] = useState(webTelemetry()?.enabled ?? true);
  useEffect(() => { track("screen.viewed", { screen: "settings" }); }, []);
  const syncLabel = {
    connecting: "Подключаемся",
    synced: "Всё сохранено",
    offline: "Офлайн",
    syncing: state.pending
      ? `Синхронизация · ${state.pending}`
      : "Синхронизация",
    locked: "Подключить хранилище",
    error: state.pending
      ? `На устройстве · ${state.pending}`
      : "Нет связи с сервером",
  }[state.status];
  return (
    <Modal label="Настройки" className="settings-modal" onClose={onClose}>
      <div className="modal-top">
        <h2>Настройки</h2>
        <button
          className="icon-button"
          aria-label="Закрыть настройки"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="settings-content">
        <div className="settings-group">
          <span className="eyebrow">РЕДАКТОР</span>
          <button
            className="quiet-button outlined"
            onClick={() => {
              onClose();
              requestAnimationFrame(showCommandPreferences);
            }}
          >
            Команды и алиасы редактора
          </button>
          <p className="muted">
            Свои названия для слеш-команд. /todo и /туду работают по умолчанию.
          </p>
        </div>
        <div className="settings-group">
          <span className="eyebrow">ХРАНИЛИЩЕ</span>
          <p className="settings-status">
            <span
              className={`status-dot ${state.status === "synced" ? "online" : ""}`}
            />
            {syncLabel}
          </p>
          <p className="muted">
            Заметки сразу сохраняются в этом браузере. Подключи хранилище, чтобы
            они были на всех устройствах.
          </p>
          <div className="account-settings"><strong>{account?.name}</strong><small>{account?.email}</small>{account?.admin && <p><a href="/admin">Пользователи ↗</a></p>}</div>
          {state.status === "locked" ? <a className="quiet-button outlined" href="/">Войти снова</a> : <button className="quiet-button outlined" onClick={() => void store.sync()}><RefreshCw size={15} />Синхронизировать сейчас</button>}
          {state.errors.map((error) => (
            <p className="form-error" key={error.id}>
              <a href={notePath(error.id)}>{error.title}</a>: {error.message}
            </p>
          ))}
          {state.pending > 0 && (
            <p className="muted">
              Ещё не отправлено на сервер: {state.pending}
            </p>
          )}
        </div>
        <div className="settings-group">
          <span className="eyebrow">ВНЕШНИЙ ВИД</span>
          <div className="theme-choice" role="group" aria-label="Тема">
            <button
              className={!theme || theme === "system" ? "selected" : ""}
              aria-pressed={!theme || theme === "system"}
              onClick={() => setTheme("system")}
            >
              <Monitor size={18} />
              Системная
            </button>
            <button
              className={theme === "light" ? "selected" : ""}
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              <Sun size={18} />
              Светлая
            </button>
            <button
              className={theme === "dark" ? "selected" : ""}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <Moon size={18} />
              Тёмная
            </button>
          </div>
        </div>
        <div className="settings-group">
          <span className="eyebrow">ТВОИ ДАННЫЕ</span>
          <button
            className="quiet-button outlined"
            onClick={() => {
              const blob = new Blob(
                [
                  JSON.stringify(
                    {
                      version: 1,
                      exportedAt: new Date().toISOString(),
                      notes: state.notes,
                    },
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `doompile-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download size={16} />
            Экспортировать заметки · JSON
          </button>
          <button
            className="quiet-button"
            onClick={() => {
              onClose();
              onHelp();
            }}
          >
            <Link2 size={16} />
            Как сохранять из браузера
          </button>
          <button
            className="quiet-button"
            onClick={async () => {
              if (state.pending) {
                notify(
                  "Сначала дождись синхронизации — на устройстве есть неотправленные заметки.",
                );
                return;
              }
              if (
                !window.confirm(
                  "Выйти из аккаунта и очистить локальный кэш заметок?",
                )
              )
                return;
              const r = await accountFetch("/api/session", { method: "DELETE" });
              if (r.ok) {
                await store.clearLocalData();
                forgetAccount();
                location.assign("/");
              }
            }}
          >
            <LogOut size={16} />
            Выйти из аккаунта
          </button>
        </div>
        <div className="settings-group">
          <span className="eyebrow">ДИАГНОСТИКА</span>
          <button className="quiet-button outlined" onClick={() => void exportDiagnostics().catch(() => notify("Не удалось выгрузить диагностику. Проверь доступ к хранилищу браузера."))}>
            <Download size={16} /> Поделиться диагностикой
          </button>
          <p className="muted">Последние события и ошибки сохраняются на устройстве даже без интернета. Дамп не содержит текстов заметок, поисковых запросов и ключей доступа.</p>
          <label><input type="checkbox" checked={telemetryEnabled} onChange={event => { const enabled = event.target.checked; setSending(enabled); void setTelemetryEnabled(enabled); }} /> Отправлять диагностику и события использования</label>
        </div>
        <div className="settings-brand">
          <Halo />
          <Wordmark />
          <span>{brandCopy.tagline}</span>
        </div>
      </div>
    </Modal>
  );
}
