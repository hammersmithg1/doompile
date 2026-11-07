"use client";
import { Mic } from "../../../packages/design/ui-icons";
import { recordingSession } from "@/lib/client/recording";
import { useRecording } from "./use-recording";
export default function VoiceCapture({ disabled }: { disabled?: boolean }) {
  const state = useRecording();
  if (state.draft?.target === "quick") return null;
  return (
    <button
      type="button"
      className="icon-button quick-voice"
      disabled={disabled || state.status !== "idle"}
      aria-label="Записать голосовую заметку"
      title="Записать голосовую заметку"
      onClick={() => void recordingSession.start("quick")}
    >
      <Mic size={18} />
    </button>
  );
}
