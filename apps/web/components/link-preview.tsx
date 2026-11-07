"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Globe2 } from "../../../packages/design/ui-icons";
import type { LinkPreview as Preview } from "@/lib/server/link-preview";
import { safeURL } from "./document";
import { accountFetch as fetch } from "@/lib/client/account";
const cache = new Map<string, Promise<Preview | null>>();
export default function LinkPreview({ url, href }: { url: string; href?: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const root = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setImageFailed(false);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        if (!cache.has(url)) {
          if (cache.size >= 256) cache.delete(cache.keys().next().value!);
          cache.set(
            url,
            fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null),
          );
        }
        void cache.get(url)!.then((result) => {
          if (active) setPreview(result);
        });
      },
      { rootMargin: "120px" },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [url]);
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  const type = preview?.type;
  const typeLabel = type?.startsWith("video")
    ? "Видео"
    : type?.startsWith("music")
      ? "Аудио"
      : type === "article"
        ? "Статья"
        : type === "profile"
          ? "Профиль"
          : type === "book"
            ? "Книга"
            : type?.startsWith("product")
              ? "Товар"
              : "Ссылка";
  return (
    <a
      ref={root}
      className="attachment-card link-preview"
      href={safeURL(href || url)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <span className="attachment-art">
        {preview?.image && !imageFailed ? (
          <img
            src={safeURL(preview.image)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Globe2 size={22} strokeWidth={1.5} />
        )}
      </span>
      <span className="attachment-info">
        <strong>{preview?.title || host}</strong>
        {preview?.description && (
          <span className="link-description">{preview.description}</span>
        )}
        <small>
          {preview?.siteName || host}
          <span>·</span>
          {typeLabel}
        </small>
      </span>
      <ArrowUpRight className="attachment-action" size={16} />
    </a>
  );
}
