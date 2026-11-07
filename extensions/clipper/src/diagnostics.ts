import { errorProperties } from "../../../packages/telemetry/core";
let installed = false;
export function install() {
  if (installed) return;
  installed = true;
  (globalThis as any).__doompileDiagnosticsDispose?.();
  const api = (globalThis as any).browser || (globalThis as any).chrome;
  const report = (error: unknown) => {
    try {
      void api?.runtime
        ?.sendMessage({
          type: "doompile:telemetry",
          name: "runtime.error",
          properties: errorProperties(error),
        })
        .catch(() => {});
    } catch {
      /* No live background context. */
    }
  };
  const error = (event: ErrorEvent) => report(event.error);
  const rejection = (event: PromiseRejectionEvent) => report(event.reason);
  globalThis.addEventListener("error", error);
  globalThis.addEventListener("unhandledrejection", rejection);
  (globalThis as any).__doompileDiagnosticsDispose = () => {
    globalThis.removeEventListener("error", error);
    globalThis.removeEventListener("unhandledrejection", rejection);
  };
}
