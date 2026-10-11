/** Turn an error body from the API into one plain-words message, with how to fix it where we know. Pure. */

const FIXES: Record<string, string> = {
  data_file_missing: "Set F1GSTATS_DB in your .env file to point at it, then try again.",
  data_error: "Run the F1GStats data check, then try again.",
};

/** The server's message plus a fix for the errors we know, or null when the body has no usable message. */
export function explainServerError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { message, error } = body as { message?: unknown; error?: unknown };
  if (typeof message !== "string" || message === "") return null;
  const fix = typeof error === "string" ? FIXES[error] : undefined;
  return fix ? `${message} ${fix}` : message;
}
