"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { currentAccount, setAccount, type Account } from "@/lib/client/account";
import Landing from "./landing";
import { telemetryFetch } from "@/lib/client/telemetry";
const AccountContext = createContext<Account | null>(null);
export const useAccount = () => useContext(AccountContext)!;
export default function AccountGate({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const [user, setUser] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [configuration, setConfiguration] = useState({
    providers: [
      { id: "yandex", enabled: false },
      { id: "google", enabled: false },
    ],
    development: false,
  });
  useEffect(() => {
    let alive = true;
    const lock = () => {
      if (alive) {
        setUser(null);
        sessionStorage.removeItem("doompile-account");
      }
    };
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("doompile-auth")
        : null;
    if (channel) channel.onmessage = () => location.reload();
    const changed = (event: StorageEvent) => {
      if (event.key === "doompile-active-user") location.reload();
    };
    const check = async () => {
      try {
        const response = await telemetryFetch("/api/session", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("Session unavailable");
        const session = await response.json();
        if (!alive) return;
        setConfiguration(session);
        if (!session.authenticated || !session.user) {
          lock();
          return;
        }
        const previous = localStorage.getItem("doompile-active-user");
        if (currentAccount() && currentAccount()!.id !== session.user.id) {
          location.reload();
          return;
        }
        setAccount(session.user);
        localStorage.setItem("doompile-active-user", session.user.id);
        sessionStorage.setItem(
          "doompile-account",
          JSON.stringify(session.user),
        );
        if (previous && previous !== session.user.id)
          channel?.postMessage("changed");
        setOffline(false);
        setUser(session.user);
      } catch {
        // Only a previously authenticated tab may reopen its own offline collection.
        try {
          const cached = JSON.parse(
            sessionStorage.getItem("doompile-account") || "null",
          );
          if (
            cached?.id &&
            localStorage.getItem("doompile-active-user") === cached.id &&
            !adminOnly
          ) {
            setAccount(cached);
            if (alive) {
              setUser(cached);
              setOffline(true);
            }
          }
        } catch {
          /* Storage may be disabled. No cached data is opened. */
        }
      } finally {
        if (alive) setReady(true);
      }
    };
    void check();
    const focus = () => {
      void check();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    window.addEventListener("storage", changed);
    window.addEventListener("doompile-session-expired", lock);
    return () => {
      alive = false;
      channel?.close();
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      window.removeEventListener("storage", changed);
      window.removeEventListener("doompile-session-expired", lock);
    };
  }, [adminOnly]);
  if (!ready)
    return (
      <main className="auth-loading" role="status">
        Doompile<span>Собираем мысли…</span>
      </main>
    );
  if (!user) return <Landing configuration={configuration} />;
  if (adminOnly && (!user.admin || offline))
    return (
      <main className="auth-loading">
        Доступ закрыт<a href="/">К заметкам</a>
      </main>
    );
  return (
    <AccountContext.Provider value={user}>{children}</AccountContext.Provider>
  );
}
