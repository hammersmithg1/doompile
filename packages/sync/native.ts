import { stage, receive, recovery } from "./client";
import { prepare, sameState } from "./model";
import { migrateSnapshot } from "./legacy";
export function run(json: string): string {
  const value = JSON.parse(json);
  switch (value.op) {
    case "stage": return JSON.stringify(stage(value.current, value.note, value.changes ?? [], value.origin));
    case "receive": return JSON.stringify(receive(value.current, value.server));
    case "prepare": return JSON.stringify(prepare(value.note));
    case "recovery": return JSON.stringify(recovery(value.note, value.server));
    case "equal": return JSON.stringify(sameState(value.left, value.right));
    case "migrate": return JSON.stringify(migrateSnapshot(value.note, value.server, value.baseline));
    default: throw new Error("Unsupported note operation");
  }
}
