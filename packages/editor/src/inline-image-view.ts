import { ResizableNodeView, type NodeViewRendererProps } from "@tiptap/core";

// A block <div> inside a paragraph is reparsed into extra blocks by the browser.
// Keep the shared resize behavior with valid inline wrappers instead.
class InlineResizeView extends ResizableNodeView {
  createContainer() {
    return asSpan(super.createContainer()) as unknown as HTMLDivElement;
  }
  createWrapper() {
    return asSpan(super.createWrapper()) as unknown as HTMLDivElement;
  }
  ignoreMutation() {
    return true;
  }
}
function asSpan(element: HTMLElement) {
  const span = document.createElement("span");
  for (const attribute of Array.from(element.attributes))
    span.setAttribute(attribute.name, attribute.value);
  span.append(...Array.from(element.childNodes));
  return span;
}
export function inlineImageView(
  props: NodeViewRendererProps,
  mediaURL: (value: unknown) => string,
) {
  const image = document.createElement("img");
  image.draggable = false;
  const render = (attrs: Record<string, any>) => {
    image.src = mediaURL(attrs.src);
    image.dataset.originalSrc = String(attrs.src || "");
    image.alt = attrs.alt || "";
    image.style.width = attrs.width ? `${Number(attrs.width)}px` : "";
    image.style.height = attrs.height ? `${Number(attrs.height)}px` : "";
  };
  render(props.node.attrs);
  const view = new InlineResizeView({
    element: image,
    node: props.node,
    editor: props.editor,
    getPos: props.getPos,
    onResize: (width, height) => {
      image.style.width = `${width}px`;
      image.style.height = `${height}px`;
    },
    onCommit: (width, height) => {
      const pos = props.getPos();
      if (pos !== undefined)
        props.editor
          .chain()
          .setNodeSelection(pos)
          .updateAttributes("image", { width, height })
          .run();
    },
    onUpdate: (node) => {
      if (node.type !== props.node.type) return false;
      render(node.attrs);
      return true;
    },
    options: {
      directions: ["bottom-left", "bottom-right"],
      min: { width: 80, height: 40 },
      preserveAspectRatio: true,
    },
  });
  return view;
}
