import { Extension, Node, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { normalizeMedia } from "./inline-media";

const metadata = "doompilePreserved";
const fallbackTypes = new Set(["unsupportedBlock", "unsupportedInline"]);
function fallback(name: string, inline: boolean) {
  return Node.create({
    name,
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    selectable: true,
    addAttributes() {
      return { raw: { default: null, rendered: false } };
    },
    parseHTML() {
      return [
        {
          tag: `${inline ? "span" : "div"}[data-doompile-unsupported]`,
          getAttrs(element) {
            try {
              return {
                raw: JSON.parse(
                  (element as HTMLElement).getAttribute(
                    "data-doompile-unsupported",
                  )!,
                ),
              };
            } catch {
              return false;
            }
          },
        },
      ];
    },
    renderHTML({ node }) {
      return [
        inline ? "span" : "div",
        {
          "data-doompile-unsupported": JSON.stringify(node.attrs.raw),
          class: "editor-render-error",
          contenteditable: "false",
          role: "note",
        },
        "Ошибка отрисовки",
      ];
    },
  });
}
export const UnsupportedBlock = fallback("unsupportedBlock", false);
export const UnsupportedInline = fallback("unsupportedInline", true);

/** Extra attributes travel with each node, including after moves/copy/undo. */
export function preserveAttributes(schema: Schema) {
  return Extension.create({
    name: "preservedAttributes",
    addGlobalAttributes() {
      return [
        {
          types: [
            ...Object.keys(schema.nodes).filter(
              (type) => type !== "text" && !fallbackTypes.has(type),
            ),
            ...Object.keys(schema.marks),
          ],
          attributes: { [metadata]: { default: null, rendered: false } },
        },
      ];
    },
  });
}
function attributes(
  attrs: Record<string, unknown> | undefined,
  known: Record<string, unknown> = {},
) {
  if (!attrs) return undefined;
  const extra = Object.fromEntries(
    Object.entries(attrs).filter(([key]) => !(key in known)),
  );
  return {
    ...attrs,
    ...(Object.keys(extra).length ? { [metadata]: extra } : {}),
  };
}

/** Reject only the unsupported subtree, never the entire valid surrounding document. */
export function prepareForEditor(
  body: JSONContent,
  schema: Schema,
  slice = false,
): JSONContent {
  const visit = (raw: JSONContent, inline = false): JSONContent => {
    const unsupported = (): JSONContent => ({
      type: inline ? "unsupportedInline" : "unsupportedBlock",
      attrs: { raw },
    });
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      (raw.content !== undefined && !Array.isArray(raw.content)) ||
      (raw.marks !== undefined && !Array.isArray(raw.marks))
    )
      return unsupported();
    const type = schema.nodes[raw.type || ""];
    if (!type) return unsupported();
    if (fallbackTypes.has(type.name)) return raw;
    if (raw.type === "text" && (typeof raw.text !== "string" || !raw.text))
      return unsupported();
    if (raw.marks?.some((mark) => !mark || !schema.marks[mark.type]))
      return unsupported();
    let result: JSONContent = {
      ...raw,
      ...(raw.attrs ? { attrs: attributes(raw.attrs, type.spec.attrs) } : {}),
      ...(raw.marks
        ? {
            marks: raw.marks.map((mark) => ({
              ...mark,
              ...(mark.attrs
                ? {
                    attrs: attributes(
                      mark.attrs,
                      schema.marks[mark.type].spec.attrs,
                    ),
                  }
                : {}),
            })),
          }
        : {}),
      ...(raw.content
        ? {
            content: raw.content.map((child) =>
              visit(child, type.inlineContent),
            ),
          }
        : {}),
    };
    result = normalizeMedia(result);
    try {
      schema.nodeFromJSON(result).check();
    } catch {
      return unsupported();
    }
    return result;
  };
  if (slice)
    return {
      type: "doc",
      content: (body.content || []).map((node) =>
        visit(node, !!schema.nodes[node.type || ""]?.isInline),
      ),
    };
  const result = visit(body);
  return result.type === "doc" ? result : { type: "doc", content: [result] };
}

/** Internal placeholders never become part of the stored wire format. */
export function restoreDocument(node: JSONContent): JSONContent {
  if (fallbackTypes.has(node.type || "") && node.attrs?.raw)
    return node.attrs.raw;
  const restoreAttrs = (attrs?: Record<string, unknown>) => {
    if (!attrs) return undefined;
    const { [metadata]: extra, ...known } = attrs;
    return { ...(extra && typeof extra === "object" ? extra : {}), ...known };
  };
  return {
    ...node,
    ...(node.attrs ? { attrs: restoreAttrs(node.attrs) } : {}),
    ...(node.marks
      ? {
          marks: node.marks.map((mark) => ({
            ...mark,
            ...(mark.attrs ? { attrs: restoreAttrs(mark.attrs) } : {}),
          })),
        }
      : {}),
    ...(node.content ? { content: node.content.map(restoreDocument) } : {}),
  };
}
