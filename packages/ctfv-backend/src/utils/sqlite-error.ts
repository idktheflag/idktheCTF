/** Inspect wrapped D1 errors without treating SQL text or parameter values as errors. */
export function isUniqueConstraintError(error: unknown, column: string): boolean {
  let cause: unknown = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++, cause = cause.cause) {
    const message = cause.message.replace(/^D1_ERROR: /, "");
    if (message.startsWith(`UNIQUE constraint failed: ${column}`)) return true;
  }
  return false;
}
