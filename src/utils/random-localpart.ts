import { randomBytes } from "node:crypto";

export function randomProbeLocalPart(prefix = "vsc"): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}
