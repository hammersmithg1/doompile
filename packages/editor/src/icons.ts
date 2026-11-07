import { createIcon, type IconName } from "../../design/icons";
const names: Record<string, IconName> = {
  text: "type", heading: "heading2", bullet: "list", ordered: "list-ordered",
  task: "list-checks", nested: "list-tree", quote: "quote", code: "code2",
  divider: "minus", table: "table2", image: "image", file: "file", voice: "mic",
  drawing: "highlighter", source: "link2", settings: "settings2", move: "grip-vertical",
};
export function icon(name: string) { return createIcon(names[name] || "type"); }
