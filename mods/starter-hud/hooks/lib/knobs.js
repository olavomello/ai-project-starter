// Pure helpers — no `$`. Reads the "Task token budget S / M / L" knob out of
// an AGENTS.md section-0 table. Format: `off` (default, budget disabled) or
// three numbers separated by `/`, e.g. `40000 / 120000 / 300000`.

const ROW = /\|\s*Task token budget S \/ M \/ L\s*\|\s*(.+?)\s*\|/;

/** Returns null when the knob is absent or "off"; otherwise {S, M, L} (numbers). */
export function parseBudgetKnob(agentsMdText) {
  const m = ROW.exec(agentsMdText || '');
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw || /^off$/i.test(raw)) return null;
  const parts = raw.split('/').map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  const [S, M, L] = parts;
  return { S, M, L };
}

/** Ceiling for a given size letter, or null when the budget is off or the size is "off"/unknown. */
export function ceilingFor(knob, size) {
  if (!knob || !size) return null;
  return knob[size] ?? null;
}
