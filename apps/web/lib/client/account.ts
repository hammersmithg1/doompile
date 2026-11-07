"use client";
import { startTelemetry, telemetryFetch, track } from "./telemetry";
export type Account = {
  id: string;
  email: string;
  name: string;
  provider: string;
  admin: boolean;
};
let active: Account | null = null;
export function setAccount(account: Account) {
  if (active && active.id !== account.id)
    throw new Error("Reload before switching accounts.");
  active = account;
  startTelemetry(account.id);
}
export function currentAccount() {
  return active;
}
export function accountID() {
  if (!active) throw new Error("Sign in before opening local data.");
  return active.id;
}
export function accountDatabaseName(name: string) {
  return `${name}:user:${accountID()}`;
}
const key = (name: string) =>
  ["doompile-theme", "doompile-detail-width"].includes(name)
    ? name
    : `${name}:user:${accountID()}`;
export const accountStorage = {
  getItem(name: string) {
    return window.localStorage.getItem(key(name));
  },
  setItem(name: string, value: string) {
    window.localStorage.setItem(key(name), value);
  },
  removeItem(name: string) {
    window.localStorage.removeItem(key(name));
  },
};
export async function accountFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(
    init?.headers || (input instanceof Request ? input.headers : undefined),
  );
  headers.set("X-Doompile-User-ID", accountID());
  const response = await telemetryFetch(input, { ...init, headers });
  if (response.status === 401)
    window.dispatchEvent(new Event("doompile-session-expired"));
  return response;
}
export function forgetAccount() {
  track("auth.signed_out");
  localStorage.removeItem("doompile-active-user");
  sessionStorage.removeItem("doompile-account");
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("doompile-auth");
    channel.postMessage("changed");
    channel.close();
  }
}
