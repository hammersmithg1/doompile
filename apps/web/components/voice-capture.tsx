"use client";

import { useRef, type PointerEvent } from "react";
import { ArrowUp, Mic } from "../../../packages/design/ui-icons";
import { recordingSession, type RecordingState } from "@/lib/client/recording";

const holdDuration = 350;

export default function VoiceCapture({
  recording,
  hasContent,
  sending,
  send,
}: {
  recording: RecordingState;
  hasContent: boolean;
  sending: boolean;
  send: () => Promise<void>;
}) {
  const press = useRef<{ id: number; time: number } | null>(null);
  const ignoreClick = useRef(false);
  const showSend = hasContent || recording.draft?.target === "quick";
  const unavailable =
    sending ||
    (showSend
      ? recording.draft?.target === "quick" &&
        ["starting", "stopping", "uploading"].includes(recording.status)
      : recording.status !== "idle");
  function release(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const current = press.current;
    if (current?.id !== event.pointerId) return;
    press.current = null;
    const { left, right, top, bottom } =
      event.currentTarget.getBoundingClientRect();
    const outside =
      event.clientX < left ||
      event.clientX > right ||
      event.clientY < top ||
      event.clientY > bottom;
    if (cancelled || outside) {
      recordingSession.stop();
    } else if (
      event.timeStamp - current.time >= holdDuration &&
      recordingSession.getSnapshot().status === "recording"
    ) {
      void send();
    }
  }

  return (
    <button
      type="button"
      className={`composer-primary ${showSend ? "send-button" : "icon-button quick-voice"}`}
      aria-disabled={unavailable || undefined}
      aria-label={showSend ? "Сохранить заметку" : "Записать голосовую заметку"}
      title={
        showSend
          ? "Сохранить заметку"
          : "Нажать для записи или удерживать для быстрой отправки"
      }
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        ignoreClick.current = false;
        if (showSend || unavailable || !event.isPrimary || event.button !== 0)
          return;
        event.currentTarget.setPointerCapture(event.pointerId);
        press.current = { id: event.pointerId, time: event.timeStamp };
        ignoreClick.current = true;
        void recordingSession.start("quick");
      }}
      onPointerUp={(event) => release(event, false)}
      onPointerCancel={(event) => release(event, true)}
      onLostPointerCapture={(event) => release(event, true)}
      onClick={(event) => {
        if (event.detail && ignoreClick.current) {
          ignoreClick.current = false;
          return;
        }
        if (unavailable) return;
        if (showSend) void send();
        else void recordingSession.start("quick");
      }}
    >
      {showSend ? <ArrowUp size={22} /> : <Mic size={20} />}
    </button>
  );
}
