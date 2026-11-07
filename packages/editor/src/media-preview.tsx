"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  LoaderCircle,
  Square,
  File,
  FileArchive,
  FileCode2,
  FileText,
  ImageIcon,
  Pause,
  Play,
  Presentation,
  Table2,
} from "../../design/ui-icons";
export type PreviewAttachment = {
  id?: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
};
const safeURL = (url: unknown) =>
  typeof url === "string" &&
  /^(https?:\/\/|\/api\/attachments\/|blob:|doompile-media:)/.test(url)
    ? url
    : "";
type Attachment = PreviewAttachment;

export function fileSize(size: number) {
  if (size < 1024) return `${size} Б`;
  const units = ["КБ", "МБ", "ГБ", "ТБ"];
  let value = size / 1024,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const waveforms = new Map<string, number[]>();
export function AudioPreview({
  attachment,
  onDownload,
}: {
  attachment: Attachment;
  onDownload?: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState(false);
  const [peaks, setPeaks] = useState<number[]>(
    waveforms.get(attachment.url) || [],
  );
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const pauseOthers = (event: Event) => {
      if ((event as CustomEvent).detail !== audio.current)
        audio.current?.pause();
    };
    window.addEventListener("doompile-audio-play", pauseOthers);
    return () => window.removeEventListener("doompile-audio-play", pauseOthers);
  }, []);
  useEffect(() => {
    if (
      !visible ||
      peaks.length ||
      !attachment.size ||
      attachment.size > 12 * 1024 * 1024
    )
      return;
    const controller = new AbortController();
    let context: AudioContext | undefined;
    void (async () => {
      const response = await fetch(safeURL(attachment.url), {
        signal: controller.signal,
      });
      if (!response.ok) return;
      const bytes = await response.arrayBuffer();
      if (controller.signal.aborted) return;
      context = new AudioContext();
      const buffer = await context.decodeAudioData(bytes);
      if (controller.signal.aborted) return;
      const bins = Array.from({ length: 64 }, (_, i) => {
        let peak = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel),
            start = Math.floor((i * data.length) / 64),
            end = Math.floor(((i + 1) * data.length) / 64);
          const step = Math.max(1, Math.floor((end - start) / 500));
          for (let p = start; p < end; p += step)
            peak = Math.max(peak, Math.abs(data[p]));
        }
        return peak;
      });
      const max = Math.max(...bins, 0.01),
        normalized = bins.map((p) => p / max);
      if (waveforms.size >= 64)
        waveforms.delete(waveforms.keys().next().value!);
      waveforms.set(attachment.url, normalized);
      setPeaks(normalized);
      setDuration(buffer.duration);
    })()
      .catch(() => {})
      .finally(() => {
        void context?.close();
      });
    return () => {
      controller.abort();
    };
  }, [visible, attachment.url, attachment.size, peaks.length]);
  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (!element.getAttribute("src")) {
      element.src = safeURL(attachment.url);
      setVisible(true);
    }
    if (!element.paused) {
      element.pause();
      return;
    }
    try {
      setError(false);
      window.dispatchEvent(
        new CustomEvent("doompile-audio-play", { detail: element }),
      );
      await element.play();
    } catch {
      setError(true);
    }
  }
  const progress = duration ? position / duration : 0;
  return (
    <div
      ref={root}
      className="attachment-audio"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <audio
        ref={audio}
        src={visible ? safeURL(attachment.url) : undefined}
        preload="metadata"
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration))
            setDuration(e.currentTarget.duration);
        }}
        onDurationChange={(e) => {
          if (Number.isFinite(e.currentTarget.duration))
            setDuration(e.currentTarget.duration);
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError(true)}
      />
      <button
        type="button"
        className="audio-play"
        aria-label={`${playing ? "Приостановить" : "Слушать"} ${attachment.name}`}
        onClick={() => void toggle()}
      >
        {playing ? (
          <Pause size={20} fill="currentColor" />
        ) : (
          <Play size={20} fill="currentColor" />
        )}
      </button>
      <div className="audio-track">
        <div className="audio-waveform" aria-hidden="true">
          {Array.from({ length: 64 }, (_, i) => (
            <i
              key={i}
              className={i / 64 <= progress && position > 0 ? "played" : ""}
              style={{ height: `${3 + (peaks[i] || 0) * 22}px` }}
            />
          ))}
        </div>
        <input
          className="audio-seek"
          type="range"
          min="0"
          max={duration || 1}
          step="0.01"
          value={Math.min(position, duration || 1)}
          disabled={!duration}
          aria-label={`Перемотать ${attachment.name}`}
          aria-valuetext={`${clock(position)} из ${clock(duration)}`}
          onChange={(e) => {
            const seconds = Number(e.target.value);
            if (audio.current) audio.current.currentTime = seconds;
            setPosition(seconds);
          }}
        />
        <span className="audio-time">
          <span
            className="audio-status-label"
            title={error ? "Не удалось воспроизвести" : undefined}
          >
            {error
              ? "Не удалось воспроизвести"
              : clock(playing || position > 0 ? position : duration)}
          </span>
          <span className="audio-dot" />
          {playing && duration > 0 && <small>/ {clock(duration)}</small>}
        </span>
      </div>
      <a
        href={safeURL(attachment.url)}
        download={attachment.name}
        target="_blank"
        rel="noreferrer"
        className="audio-download"
        aria-label={`${onDownload ? "Открыть" : "Скачать"} ${attachment.name}`}
        onClick={(event) => {
          event.stopPropagation();
          if (onDownload) {
            event.preventDefault();
            onDownload();
          }
        }}
      >
        <ArrowDownToLine size={16} />
      </a>
    </div>
  );
}
function VideoPreview({ attachment }: { attachment: Attachment }) {
  const [ratio, setRatio] = useState(16 / 9);
  return (
    <div
      className="attachment-video"
      style={{ width: `${Math.min(300, 200 * ratio)}px` }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <video
        src={safeURL(attachment.url)}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const { videoWidth, videoHeight } = e.currentTarget;
          if (videoWidth && videoHeight) setRatio(videoWidth / videoHeight);
        }}
      />
      <span title={attachment.name}>{attachment.name}</span>
    </div>
  );
}
export default function AttachmentPreview({
  attachment: a,
  onOpen,
}: {
  attachment: Attachment;
  onOpen?: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageWidth, setImageWidth] = useState(240);
  if (a.mimeType.startsWith("audio/"))
    return <AudioPreview attachment={a} onDownload={onOpen} />;
  if (a.mimeType.startsWith("video/")) return <VideoPreview attachment={a} />;
  if (a.mimeType.startsWith("image/") && !imageFailed)
    return (
      <a
        className="attachment-picture"
        style={{ width: imageWidth }}
        href={safeURL(a.url)}
        target="_blank"
        rel="noreferrer"
        title={`${a.name} · ${fileSize(a.size)}`}
        aria-label={`Открыть ${a.name}`}
        onClick={(event) => {
          event.stopPropagation();
          if (onOpen) {
            event.preventDefault();
            onOpen();
          }
        }}
        onKeyDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        <img
          src={safeURL(a.url)}
          alt={a.name}
          loading="lazy"
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth && naturalHeight)
              setImageWidth(
                Math.min(
                  naturalWidth,
                  240,
                  (180 * naturalWidth) / naturalHeight,
                ),
              );
          }}
          onError={() => setImageFailed(true)}
        />
        <span className="picture-open" aria-hidden="true">
          <ArrowUpRight size={14} />
        </span>
      </a>
    );
  const extension = a.name.split(".").pop()?.toLowerCase() || "";
  const image = a.mimeType.startsWith("image/");
  const Icon = image
    ? ImageIcon
    : /zip|rar|7z|gz|tar/.test(extension)
      ? FileArchive
      : /pdf|doc|txt|md|rtf/.test(extension)
        ? FileText
        : /ppt|key|odp/.test(extension)
          ? Presentation
          : /xls|csv|ods/.test(extension)
            ? Table2
            : /json|js|ts|py|html|css|sh/.test(extension)
              ? FileCode2
              : File;
  return (
    <a
      className={`attachment-card ${image ? "attachment-image" : ""}`}
      href={safeURL(a.url)}
      target={
        image || !a.url.startsWith("/api/attachments/") ? "_blank" : undefined
      }
      download={image ? undefined : a.name}
      rel="noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        if (onOpen) {
          e.preventDefault();
          onOpen();
        }
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      aria-label={`Открыть ${a.name}`}
    >
      <span className="attachment-art">
        {image && !imageFailed ? (
          <img
            src={safeURL(a.url)}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Icon size={22} strokeWidth={1.5} />
        )}
      </span>
      <span className="attachment-info">
        <strong>{a.name}</strong>
        <small>
          {extension.toUpperCase().slice(0, 12) ||
            a.mimeType.split("/")[1] ||
            "Файл"}
          <span>·</span>
          {fileSize(a.size)}
        </small>
      </span>
      <ArrowDownToLine className="attachment-action" size={15} />
    </a>
  );
}

export type RecordingDisplay = {
  id: string;
  status: string;
  seconds: number;
  size?: number;
  url?: string;
  error?: string;
  recovered?: boolean;
  analyser?: AnalyserNode;
  levels?: number[];
};
/** Draw microphone levels without re-rendering the editor/feed on every audio frame. */
function LiveWaveform({
  analyser,
  levels,
}: {
  analyser?: AnalyserNode;
  levels?: number[];
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!analyser || !root.current) return;
    const bars = [...root.current.querySelectorAll<HTMLElement>("i")];
    const samples = new Float32Array(analyser.fftSize);
    const history = new Array<number>(64).fill(0);
    let frame = 0,
      previous = -Infinity;
    const draw = (now: number) => {
      if (now - previous >= 50) {
        previous = now;
        analyser.getFloatTimeDomainData(samples);
        let power = 0;
        for (const value of samples) power += value * value;
        const level = Math.min(1, Math.sqrt(power / samples.length) * 6);
        history.shift();
        history.push(level);
        bars.forEach((bar, i) => {
          bar.style.height = `${3 + history[i] * 22}px`;
        });
        if (root.current)
          root.current.dataset.signal = level > 0.025 ? "audible" : "silent";
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);
  return (
    <div
      ref={root}
      className="audio-waveform recording-waveform"
      role="img"
      aria-label="Уровень звука микрофона"
    >
      {Array.from({ length: 64 }, (_, i) => (
        <i key={i} style={{ height: `${3 + (levels?.[i] || 0) * 22}px` }} />
      ))}
    </div>
  );
}
export function RecordingPreview({
  state,
  onStop,
  onRetry,
}: {
  state: RecordingDisplay;
  onStop: () => void;
  onRetry?: () => void;
}) {
  const active = ["recording", "starting", "stopping"].includes(state.status);
  return (
    <div className="recording-snippet" data-recording-id={state.id}>
      {state.url && !active ? (
        <AudioPreview
          attachment={{
            url: state.url,
            name: "Голосовая заметка",
            mimeType: "audio/webm",
            size: state.size || 0,
          }}
        />
      ) : (
        <div
          className="attachment-audio recording-live"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {active && (
            <button
              type="button"
              className="audio-play recording-stop"
              onClick={onStop}
              disabled={state.status === "stopping"}
              aria-label={
                state.status === "starting"
                  ? "Отменить включение микрофона"
                  : "Остановить запись"
              }
            >
              {state.status === "starting" ? (
                <LoaderCircle className="recording-spinner" size={19} />
              ) : (
                <Square size={15} fill="currentColor" />
              )}
            </button>
          )}
          <div className="audio-track">
            <LiveWaveform analyser={state.analyser} levels={state.levels} />
            <div className="audio-time">
              <span>{clock(state.seconds)}</span>
              <span className="recording-dot" />
              <small className="audio-status-label">
                {state.status === "starting"
                  ? "Включаем микрофон…"
                  : state.status === "stopping"
                    ? "Завершаем…"
                    : active
                      ? "Идёт запись"
                      : "Сохранённая запись"}
              </small>
            </div>
          </div>
        </div>
      )}
      {(!active || state.error) && (
        <div className="recording-recovery">
          <span>
            {state.error ||
              (state.status === "uploading"
                ? "Сохраняем запись…"
                : state.recovered
                  ? "Запись восстановлена с этого устройства"
                  : "Запись сохранена на устройстве")}
          </span>
          {state.error && onRetry && !active && (
            <button type="button" onClick={onRetry}>
              Повторить сохранение
            </button>
          )}
        </div>
      )}
    </div>
  );
}
