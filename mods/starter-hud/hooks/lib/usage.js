// Pure helpers — no `$`. Usage-counter arithmetic shared by the mod's event
// hooks and its tests. A "counters" object always has this exact shape, and
// it is also the on-disk shape of the per-branch usage file (plus `model`,
// `tool_calls`, `duration_s`, `size` — see mergeUsageFile in register.jsx).

export function zeroCounters() {
  return { uncached_in: 0, cache_read: 0, cache_write: 0, out: 0 };
}

/**
 * Add one ModelUsage reading (input_tokens, output_tokens,
 * cache_read_input_tokens, cache_creation_input_tokens) into a running
 * counters object. input_tokens is already uncached-only (confirmed against
 * the engine's own type declaration), so this never double-counts.
 */
export function addUsage(counters, usage) {
  if (!usage) return counters;
  return {
    uncached_in: counters.uncached_in + (usage.input_tokens || 0),
    cache_read: counters.cache_read + (usage.cache_read_input_tokens || 0),
    cache_write: counters.cache_write + (usage.cache_creation_input_tokens || 0),
    out: counters.out + (usage.output_tokens || 0),
  };
}

export function addCounters(a, b) {
  return {
    uncached_in: a.uncached_in + b.uncached_in,
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
    out: a.out + b.out,
  };
}

/** Total input tokens, D6's definition: uncached + cache read + cache write. */
export function totalInput(counters) {
  return counters.uncached_in + counters.cache_read + counters.cache_write;
}

/** Fresh tokens only (D7): what a task budget counts against its ceiling. */
export function freshTokens(counters) {
  return counters.uncached_in + counters.cache_write + counters.out;
}

export function cacheRatio(counters) {
  const total = totalInput(counters);
  return total > 0 ? counters.cache_read / total : null;
}
