export type AppearanceMode = "system" | "light" | "dark";
export function appearanceMode(value: string | null): AppearanceMode {
  return value === "light" || value === "dark" ? value : "system";
}
export function resolvedAppearance(mode: AppearanceMode, systemDark: boolean): "light" | "dark" {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}
