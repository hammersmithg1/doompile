/** Receive native file drops anywhere in the window, without double-handling editor drops. */
export function installFileDrop(
  target: EventTarget,
  onFiles: (files: File[]) => void,
  onActive: (active: boolean) => void,
  options: { accept?: (target: EventTarget | null) => boolean } = {},
) {
  let depth = 0;
  const hasFiles = (event: DragEvent) =>
    event.dataTransfer?.types.includes("Files");
  const reset = () => {
    depth = 0;
    onActive(false);
  };
  const handlers: Record<string, (event: Event) => void> = {
    dragenter: (raw) => {
      const event = raw as DragEvent;
      if (!hasFiles(event)) return;
      if (options.accept && !options.accept(event.target)) {
        if (!event.defaultPrevented) {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        }
        return;
      }
      event.preventDefault();
      depth++;
      onActive(true);
    },
    dragover: (raw) => {
      const event = raw as DragEvent;
      if (!hasFiles(event)) return;
      if (options.accept && !options.accept(event.target)) {
        if (!event.defaultPrevented) {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        }
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    dragleave: (raw) => {
      if (!hasFiles(raw as DragEvent)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) onActive(false);
    },
    drop: (raw) => {
      const event = raw as DragEvent;
      reset();
      if (!event.dataTransfer?.files.length || event.defaultPrevented) return;
      event.preventDefault();
      if (!options.accept || options.accept(event.target))
        onFiles(Array.from(event.dataTransfer.files));
    },
    dragend: reset,
    blur: reset,
    keydown: (event) => {
      if ((event as KeyboardEvent).key === "Escape") reset();
    },
  };
  for (const [name, handler] of Object.entries(handlers))
    target.addEventListener(name, handler);
  return () => {
    for (const [name, handler] of Object.entries(handlers))
      target.removeEventListener(name, handler);
  };
}
