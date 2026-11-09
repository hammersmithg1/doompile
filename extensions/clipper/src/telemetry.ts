import {
  Recorder,
  BoundedJournal,
  catalog,
  errorProperties,
  newTrace,
  traceparent,
  routeName,
  type EventName,
  type Platform,
} from "../../../packages/telemetry/core";

type Connection =
  { endpoint?: string; user?: { id?: string } } | null | undefined;
type ExtensionAPI = {
  storage: {
    local: {
      get(key: string | string[]): Promise<Record<string, any>>;
      set(value: Record<string, unknown>): Promise<void>;
    };
  };
};
export function extensionTelemetry(
  api: ExtensionAPI,
  build: { platform: Platform; release: string },
  origins?: {
    scopeEndpoint: (endpoint: string | undefined) => string | undefined;
    currentEndpoint: (endpoint: string) => string;
  },
) {
  const recorders = new Map<string, Promise<Recorder>>();
  let work = Promise.resolve();
  let retryAt = 0,
    backoff = 1000;
  const rawFetch = globalThis.fetch.bind(globalThis);
  async function recorder(connection?: Connection) {
    if (connection === undefined)
      connection = (await api.storage.local.get("connection")).connection;
    const endpoint = origins?.scopeEndpoint(connection?.endpoint) ?? connection?.endpoint;
    const scope = connection?.user?.id
      ? `${endpoint}|${connection.user.id}`
      : "signed-out";
    if (!recorders.has(scope))
      recorders.set(
        scope,
        (async () => {
          const key = `diagnostics:${scope}`;
          const prefs = await api.storage.local.get([
            "diagnosticsDeviceID",
            `diagnostics-enabled:${scope}`,
          ]);
          let deviceID = prefs.diagnosticsDeviceID;
          if (
            typeof deviceID !== "string" ||
            !/^[0-9a-f-]{36}$/.test(deviceID)
          ) {
            deviceID = crypto.randomUUID();
            await api.storage.local.set({ diagnosticsDeviceID: deviceID });
          }
          const journal = new BoundedJournal({
            read: async () => (await api.storage.local.get(key))[key] || null,
            write: (state) => api.storage.local.set({ [key]: state }),
          });
          const result = new Recorder(journal, {
            deviceID,
            platform: build.platform,
            release: build.release,
            environment: "production",
          });
          result.enabled = prefs[`diagnostics-enabled:${scope}`] !== false;
          if (!result.enabled) await result.setEnabled(false);
          result.record("app.started");
          return result;
        })(),
      );
    return { value: await recorders.get(scope)!, scope };
  }
  function record(
    name: EventName,
    properties: Record<string, unknown> = {},
    trace = newTrace(),
    connection?: Connection,
    eventID?: string,
  ) {
    work = work
      .then(async () => {
        (await recorder(connection)).value.record(
          name,
          properties,
          trace,
          eventID,
        );
      })
      .catch(() => {});
  }
  return {
    record,
    async settled() {
      await work;
      await Promise.allSettled(
        [...recorders.values()].map(async (value) => (await value).settled()),
      );
    },
    error(
      name: EventName,
      error: unknown,
      properties: Record<string, unknown> = {},
    ) {
      record(name, { ...properties, ...errorProperties(error) });
    },
    async state() {
      const { value } = await recorder();
      return { enabled: value.enabled, ...(await value.journal.stats()) };
    },
    async setEnabled(enabled: boolean) {
      const { value, scope } = await recorder();
      await api.storage.local.set({
        [`diagnostics-enabled:${scope}`]: enabled,
      });
      await value.setEnabled(enabled);
    },
    async dump() {
      await work;
      return (await recorder()).value.dump();
    },
    async flush() {
      await work;
      const connection = (await api.storage.local.get("connection")).connection;
      if (!connection?.token || !connection?.user?.id || Date.now() < retryAt)
        return;
      const endpoint = origins?.currentEndpoint(connection.endpoint) ?? connection.endpoint;
      const { value } = await recorder(connection);
      await value.flush(async (events) => {
        try {
          const response = await rawFetch(
            `${endpoint}/api/telemetry`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${connection.token}`,
                "X-Doompile-User-ID": connection.user.id,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ events }),
              credentials: "omit",
              redirect: "error",
              signal: AbortSignal.timeout(8000),
            },
          );
          if (!response.ok) throw new Error("Telemetry unavailable");
          retryAt = 0;
          backoff = 1000;
          return true;
        } catch {
          retryAt = Date.now() + backoff;
          backoff = Math.min(300000, backoff * 2);
          return false;
        }
      });
    },
    async fetch(input: string, init?: RequestInit) {
      const trace = newTrace(),
        started = performance.now();
      const headers = new Headers(init?.headers);
      headers.set("traceparent", traceparent(trace));
      const properties = {
        route: routeName(input),
        method: init?.method || "GET",
      };
      // Capture the journal owner before awaiting a request/account change.
      const connection = await api.storage.local
        .get("connection")
        .then((value) => value.connection)
        .catch(() => undefined);
      try {
        const response = await rawFetch(input, { ...init, headers });
        record(
          response.status >= 500 ? "http.failed" : "http.completed",
          {
            ...properties,
            status: response.status,
            duration_ms: performance.now() - started,
          },
          trace,
          connection,
        );
        return response;
      } catch (error) {
        record(
          "http.failed",
          {
            ...properties,
            ...errorProperties(error),
            duration_ms: performance.now() - started,
          },
          trace,
          connection,
        );
        throw error;
      }
    },
  };
}
export { catalog, errorProperties };
