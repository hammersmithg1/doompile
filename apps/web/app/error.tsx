"use client";
import { useEffect } from "react";
import { captureWebError, exportDiagnostics } from "../lib/client/telemetry";
export default function AppError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    captureWebError(error);
  }, [error]);
  return (
    <main className="auth-loading">
      <p>Не удалось открыть приложение. Локальные заметки сохранены.</p>
      <button onClick={reset}>Попробовать снова</button>
      <button onClick={() => void exportDiagnostics()}>
        Поделиться диагностикой
      </button>
    </main>
  );
}
