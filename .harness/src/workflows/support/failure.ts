// Why something failed, as a line to show or to store (no I/O, so it's deterministic)

// Temporal wraps the failure of an activity or a child workflow in one that only says which one failed:
// the reason, for example the judge's FAILED: <why>, is in its cause
export function failureMessage(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause;
  if (cause instanceof Error) return cause.message;
  return err instanceof Error ? err.message : String(err);
}
