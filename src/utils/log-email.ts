import { getConfig } from "../config/env.js";

/** Masks local part when `LOG_FULL_EMAIL` is false. */
export function redactEmailForLog(email: string | undefined): string | undefined {
  if (email === undefined) return undefined;
  if (getConfig().LOG_FULL_EMAIL) return email;
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
