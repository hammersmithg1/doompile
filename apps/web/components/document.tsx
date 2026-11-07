import { Fragment } from "react";
import { sourceLink, type SourceLink } from "@doompile/core";
import AttachmentPreview from "./attachment-preview";
type Block = {
  type?: string;
  text?: string;
  content?: Block[];
  attrs?: Record<string, any>;
  marks?: { type: string; attrs?: Record<string, any> }[];
};
export function safeURL(url: unknown) {
  if (typeof url !== "string") return "";
  return /^(https?:\/\/|\/api\/attachments\/|\/?\?note=)/.test(url) ? url : "";
}
export function SourceSnippet({
  source,
}: {
  source: SourceLink & {title?:string};
}) {
  const href = sourceLink(source);
  let host = source.title || "Источник";
  try {
    host = new URL(href).hostname.replace(/^www\./, "");
  } catch {}
  return (
    <aside className="source-snippet">
      {source.quote && <blockquote>{source.quote}</blockquote>}
      <a
        title={source.quote ? "Открыть источник у цитаты" : source.title || href}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        ↗ {host}
      </a>

    </aside>
  );
}
export default function Document({
  value,
  onReference,
}: {
  value: unknown;
  onReference?: (id: string) => void;
}) {
  function render(node: Block, key: number | string): React.ReactNode {
    const children = node.content?.map((n, i) => render(n, i));
    const attrs = node.attrs || {};
    if (node.type === "text") {
      let text: React.ReactNode = node.text;
      for (const mark of node.marks || []) {
        if (mark.type === "bold") text = <strong>{text}</strong>;
        if (mark.type === "italic") text = <em>{text}</em>;
        if (mark.type === "strike") text = <s>{text}</s>;
        if (mark.type === "code") text = <code>{text}</code>;
        if (mark.type === "underline") text = <u>{text}</u>;
        if (mark.type === "link")
          text = (
            <a
              href={safeURL(mark.attrs?.href)}
              target="_blank"
              rel="noreferrer"
            >
              {text}
            </a>
          );
      }
      return <Fragment key={key}>{text}</Fragment>;
    }
    switch (node.type) {
      case "doc":
        return <Fragment key={key}>{children}</Fragment>;
      case "paragraph":
        return <p key={key}>{children || <br />}</p>;
      case "heading": {
        const Tag = ["h1", "h2", "h3", "h4", "h5", "h6"][
          Math.max(0, Math.min(5, (attrs.level || 2) - 1))
        ] as "h1";
        return <Tag key={key}>{children}</Tag>;
      }
      case "bulletList":
        return <ul key={key}>{children}</ul>;
      case "orderedList":
        return (
          <ol key={key} start={attrs.start || 1}>
            {children}
          </ol>
        );
      case "listItem":
        return <li key={key}>{children}</li>;
      case "taskList":
        return (
          <ul key={key} className="task-list">
            {children}
          </ul>
        );
      case "taskItem":
        return (
          <li key={key} className={attrs.checked ? "checked" : ""}>
            <input
              type="checkbox"
              checked={!!attrs.checked}
              readOnly
              tabIndex={-1}
            />
            <div>{children}</div>
          </li>
        );
      case "blockquote":
        return <blockquote key={key}>{children}</blockquote>;
      case "codeBlock":
        return (
          <pre key={key}>
            <code>{children}</code>
          </pre>
        );
      case "hardBreak":
        return <br key={key} />;
      case "horizontalRule":
        return <hr key={key} />;
      case "image":
        return (
          <a
            key={key}
            href={safeURL(attrs.src)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Открыть ${attrs.alt || "изображение"}`}
          >
            <img
              src={safeURL(attrs.src)}
              alt={attrs.alt || "Вложение"}
              style={
                attrs.width
                  ? {
                      width: Number(attrs.width),
                      maxWidth: "100%",
                      height: "auto",
                    }
                  : undefined
              }
              loading="lazy"
            />
          </a>
        );
      case "attachment":
        return (
          <AttachmentPreview
            key={key}
            attachment={{
              id: String(attrs.id || ""),
              url: String(attrs.url || ""),
              name: String(attrs.name || "Файл"),
              mimeType: String(attrs.mimeType || "application/octet-stream"),
              size: Number(attrs.size) || 0,
            }}
          />
        );
      case "sourceSnippet":
        return (
          <SourceSnippet
            key={key}
            source={{ url: attrs.url, title: attrs.title, quote: attrs.quote, quotePrefix:attrs.quotePrefix, quoteSuffix:attrs.quoteSuffix, timestampSeconds:attrs.timestampSeconds }}
          />
        );
      case "noteReference":
        return (
          <button
            type="button"
            key={key}
            className="note-reference"
            onClick={() => onReference?.(attrs.id)}
          >
            ↗ {attrs.title || "Заметка"}
          </button>
        );
      case "table":
        return (
          <div className="table-scroll" key={key}>
            <table>
              <tbody>{children}</tbody>
            </table>
          </div>
        );
      case "tableRow":
        return <tr key={key}>{children}</tr>;
      case "tableHeader":
        return (
          <th
            key={key}
            colSpan={attrs.colspan || 1}
            rowSpan={attrs.rowspan || 1}
          >
            {children}
          </th>
        );
      case "tableCell":
        return (
          <td
            key={key}
            colSpan={attrs.colspan || 1}
            rowSpan={attrs.rowspan || 1}
          >
            {children}
          </td>
        );
      default:
        return <span key={key} className="document-render-error" role="note" title={`Неподдерживаемый блок: ${node.type || "unknown"}`}>Ошибка отрисовки</span>;
    }
  }
  return (
    <div className="document">
      {render((value || { type: "doc" }) as Block, 0)}
    </div>
  );
}
