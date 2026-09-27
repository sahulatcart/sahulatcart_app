// Run tasks one at a time per key, in arrival order; different keys run in parallel.
// Used so two quick messages from the same buyer never race over one conversation's state.
// In-process only — correct while the backend runs as a single instance.
const tails = new Map<string, Promise<void>>();

export function serialize(key: string, task: () => Promise<void>): Promise<void> {
  const run = (tails.get(key) ?? Promise.resolve()).then(task);
  // The chain continues after a failure; the caller still sees this task's own rejection.
  const tail = run.catch(() => {});
  tails.set(key, tail);
  void tail.then(() => tails.get(key) === tail && tails.delete(key));
  return run;
}

/** Keys with work queued or running (for tests and diagnostics). */
export const pendingKeys = (): number => tails.size;
