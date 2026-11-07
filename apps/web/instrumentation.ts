import type { Instrumentation } from "next";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEvent } = await import("./lib/server/telemetry");
    const { errorProperties } = await import("../../packages/telemetry/core");
    serverEvent("app.started");
    // Monitoring does not replace Node's normal crash/exit behavior.
    process.on("uncaughtExceptionMonitor", (error) =>
      serverEvent("runtime.error", errorProperties(error)),
    );
  }
}
export const onRequestError: Instrumentation.onRequestError = async (error) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEvent } = await import("./lib/server/telemetry");
    const { errorProperties } = await import("../../packages/telemetry/core");
    serverEvent("runtime.error", errorProperties(error));
  }
};
