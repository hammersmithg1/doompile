"use client";
import { LoaderCircle, Mic, Square } from "../../../packages/design/ui-icons";
import { recordingSession } from "@/lib/client/recording";
import { useRecording } from "./use-recording";
export default function VoiceCapture({ disabled }: { disabled?: boolean }) {
  const state = useRecording();
  const active = ["recording", "stopping"].includes(state.status);
  return (
    <button
      type="button"
      className={`icon-button quick-voice ${active ? "recording" : ""}`}
      disabled={
        state.status === "starting" ||
        (!active && (disabled || state.status !== "idle"))
      }
      aria-label={
        active
          ? "Завершить запись голосовой заметки"
          : "Записать голосовую заметку"
      }
      title={
        state.status === "starting"
          ? "Включаем микрофон…"
          : active
            ? "Остановить запись"
            : "Записать голосовую заметку"
      }
      onClick={() =>
        active ? recordingSession.stop() : void recordingSession.start("quick")
      }
    >
      {state.status === "starting" ? (
        <LoaderCircle className="recording-spinner" size={18} />
      ) : active ? (
        <>
          <Square size={16} />
          <span>
            {Math.floor((state.draft?.seconds || 0) / 60)}:
            {String((state.draft?.seconds || 0) % 60).padStart(2, "0")}
          </span>
        </>
      ) : (
        <Mic size={18} />
      )}
    </button>
  );
}
