"use client";
import { useEffect, useState } from "react";
import { accountFetch } from "@/lib/client/account";
type Row = {
  id: string;
  email: string;
  name: string;
  provider: string;
  lastLoginAt: string;
  lastSeenAt: string;
  bucket: string;
  usage: { bytes: number; objects: number } | null;
};
const date = (value: string) =>
  new Intl.DateTimeFormat("ru", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
function size(bytes: number) {
  if (!bytes) return "0 Б";
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(bytes / 1024 ** power)} ${["Б", "КиБ", "МиБ", "ГиБ", "ТиБ"][power]}`;
}
export default function AdminUsers() {
  const [offset, setOffset] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [total, setTotal] = useState(0);
  const [users, setUsers] = useState<Row[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  async function load(page: number) {
    setBusy(true);
    setError("");
    try {
      const response = await accountFetch(`/api/admin/users?offset=${page}`, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "Доступ к админке закрыт."
            : "Не удалось загрузить пользователей.",
        );
      const data = await response.json();
      setUsers(data.users);
      setTotal(data.total);
      setNext(data.nextOffset);
      setOffset(page);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load(0);
  }, []);
  return (
    <main className="admin">
      <header className="admin-top">
        <h1>Пользователи</h1>
        <small>{busy ? "Обновляем…" : total}</small>
        <a href="/">← Заметки</a>
        <button
          className="quiet-button"
          disabled={busy}
          onClick={() => void load(offset)}
        >
          Обновить
        </button>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="admin-table">
        <table>
          <thead>
            <tr>
              <th>Аккаунт</th>
              <th>Вход</th>
              <th>Активность</th>
              <th>S3</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td title={`${user.id}\n${user.bucket}`}>
                  {user.email}
                  <small>
                    {user.name} · {user.provider}
                  </small>
                </td>
                <td>{date(user.lastLoginAt)}</td>
                <td>{date(user.lastSeenAt)}</td>
                <td title={user.bucket}>
                  {user.usage ? (
                    <>
                      {size(user.usage.bytes)}
                      <small>{user.usage.objects} файлов</small>
                    </>
                  ) : (
                    <span title="S3 не отвечает или не настроен">
                      Недоступно
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!busy && !users.length && !error && <p>Пользователей пока нет.</p>}
      <div className="admin-actions">
        <button
          className="quiet-button"
          disabled={busy || offset === 0}
          onClick={() => void load(Math.max(0, offset - 50))}
        >
          ←
        </button>
        <span>
          {total ? `${offset + 1}–${offset + users.length} из ${total}` : "0"}
        </span>
        <button
          className="quiet-button"
          disabled={busy || next === null}
          onClick={() => next !== null && void load(next)}
        >
          →
        </button>
      </div>
    </main>
  );
}
