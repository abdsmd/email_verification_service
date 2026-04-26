export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
