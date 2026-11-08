import { telemetryFetch as fetch } from "./telemetry";
import { clipboardImageSource } from "../../../../packages/editor/src/clipboard-files";
export {
  clipboardFiles,
  clipboardImageSource,
  isDoompileClipboardHTML,
} from "../../../../packages/editor/src/clipboard-files";
export async function clipboardImage(data: DataTransfer): Promise<File | null> {
  const src = clipboardImageSource(data.getData("text/html"));
  if (!/^(https?:|data:image\/|blob:)/i.test(src)) return readClipboardImage();
  const response = await fetch(src);
  if (!response.ok)
    throw new Error(
      "Не удалось получить картинку из буфера. Скопируй само изображение или перетащи файл.",
    );
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) return null;
  return new File([blob], `Изображение.${blob.type.split("/")[1] || "png"}`, {
    type: blob.type,
  });
}

export function isLocalImagePath(text: string) {
  return /^\s*(?:file:\/\/|\/(?:Users|var|tmp|private|home)\/|[a-z]:\\).+\.(?:png|jpe?g|gif|webp|tiff?|heic|bmp)\s*$/i.test(
    text,
  );
}
export async function readClipboardImage(): Promise<File | null> {
  if (!navigator.clipboard?.read) return null;
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((type) => type.startsWith("image/"));
      if (type) {
        const data = await item.getType(type);
        return new File([data], `Изображение.${type.split("/")[1] || "png"}`, {
          type,
        });
      }
    }
  } catch {}
  return null;
}
