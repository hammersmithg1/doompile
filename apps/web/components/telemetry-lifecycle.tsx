"use client";
import { useEffect } from "react";
import { installTelemetryHooks } from "@/lib/client/telemetry";
export default function TelemetryLifecycle() {
  useEffect(installTelemetryHooks, []);
  return null;
}
