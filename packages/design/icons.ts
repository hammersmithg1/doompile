import registry from "./icons.json";

export type IconNode = [string, Record<string, string>];
export type IconName = keyof typeof registry.icons;
export const iconNodes = registry.icons;

/** One geometry for the editor, React UI, clipper and native asset catalogs. */
export function createIcon(name: IconName, size = 18) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: String(size),
    height: String(size),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, value);
  for (const [tag, attributes] of iconNodes[name].nodes as IconNode[]) {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}
