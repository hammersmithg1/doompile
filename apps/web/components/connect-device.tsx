"use client";
import { useEffect, useState } from "react";
import { accountFetch } from "@/lib/client/account";
import { useAccount } from "./account-gate";
import { Halo, Wordmark } from "./brand";
export default function ConnectDevice({ code }: { code: string }) {
  const user = useAccount();
  const [label, setLabel] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void accountFetch(
      `/api/auth/device/approve?code=${encodeURIComponent(code)}`,
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Ссылка подключения истекла. Начни вход в приложении ещё раз.",
          );
        const flow = await response.json();
        setLabel(flow.label);
        setDone(flow.approved);
      })
      .catch((error) => setError(error.message));
  }, [code]);
  async function approve() {
    setBusy(true);
    try {
      const response = await accountFetch("/api/auth/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok)
        throw new Error("Подключение не завершено. Начни вход ещё раз.");
      setDone(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="connect-card">
      <div className="landing-brand">
        <Wordmark />
        <Halo />
      </div>
      <h1>{done ? "Готово. Можно возвращаться." : "Подключить приложение?"}</h1>
      {done ? (
        <p>Вернись в приложение — оно получит доступ к твоим заметкам.</p>
      ) : (
        <>
          <p>
            <strong>{label || "Проверяем подключение…"}</strong>
            <br />
            Аккаунт: {user.email}
          </p>
          <small>
            Подтверждай, только если ты начал вход в этом приложении. Оно сможет
            читать и сохранять твои заметки и файлы.
          </small>
          <button
            className="lime-button"
            disabled={busy || !label || Boolean(error)}
            onClick={() => void approve()}
          >
            {busy ? "Подключаем…" : "Разрешить подключение"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p>
        <a href="/">К моим заметкам ↗</a>
      </p>
    </main>
  );
}
