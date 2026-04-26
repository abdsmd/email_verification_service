/** Path without query string, for route policy checks. */
export function requestPath(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}
