"use client";
import { useSyncExternalStore } from "react";
import { recordingSession } from "@/lib/client/recording";
export function useRecording() { return useSyncExternalStore(recordingSession.subscribe, recordingSession.getSnapshot, recordingSession.getServerSnapshot); }
