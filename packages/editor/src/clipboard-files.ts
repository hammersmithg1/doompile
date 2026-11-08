export function clipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files);
  if (files.length) return files;
  return Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
}

export function isDoompileClipboardHTML(html: string) {
  return /data-doompile-clipboard|data-original-src|data-attachment|data-source-snippet|src=["'][^"']*\/api\/attachments\//i.test(
    html,
  );
}

export function clipboardImageSource(html: string) {
  if (!/<img[\s>]/i.test(html)) return "";
  const template = document.createElement("template");
  template.innerHTML = html;
  return (
    template.content.querySelector("img")?.getAttribute("src")?.trim() || ""
  );
}
