import { telemetryFetch as fetch } from "./telemetry";
export function clipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files);
  if (files.length) return files;
  return Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
}
export async function clipboardImage(data: DataTransfer): Promise<File | null> {
  const html = data.getData("text/html");
  if (!html) return null;
  const document = new DOMParser().parseFromString(html, "text/html");
  const src = document.querySelector("img")?.getAttribute("src");
  if (!src || !/^(https?:|data:image\/|blob:)/i.test(src))
    return readClipboardImage();
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
