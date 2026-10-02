import { join } from 'node:path';
import { readText, writeText, existsSync } from './lib/fsutil.js';
import { isInteractive, ask, makeInterface } from './lib/prompt.js';
import { section, info } from './lib/log.js';

const KNOBS = [
  { key: 'coverage', label: 'Test coverage floor', pattern: /(\| Test coverage floor \| )(.*?)( \|)/, default: '80%' },
  { key: 'fileLines', label: 'Max file lines / function lines', pattern: /(\| Max file lines \/ function lines \| )(.*?)( \|)/, default: '800 / 50' },
  { key: 'mutation', label: 'Mutation allowed in hot paths (yes/no)', pattern: /(\| Mutation allowed in hot paths \| )(.*?)( \|)/, default: 'no' },
  { key: 'branch', label: 'Branch model', pattern: /(\| Branch model \| )(.*?)( \|)/, default: 'trunk (`main`)' },
  { key: 'cadence', label: 'Release cadence', pattern: /(\| Release cadence \| )(.*?)( \|)/, default: 'on demand' },
  { key: 'budget', label: 'Task token budget S / M / L', pattern: /(\| Task token budget S \/ M \/ L \| )(.*?)( \|)/, default: 'off' },
];

/**
 * Interactively fills AGENTS.md section 0 (Name, Purpose, Stack, Administrator,
 * knobs) in `target` right after the template is copied, so the initial commit
 * already has a real project identity instead of the template's blanks. Also
 * decides whether to enable the optional starter-hud session mod — asked
 * right after the knobs, in the same prompt, when there's a TTY to ask on.
 *
 * `modFlag` is `true`/`false` when `--mod`/`--no-mod` was passed (wins
 * outright, interactive or not) or `undefined` when neither was.
 *
 * Returns `{ configured, mod }`: `configured` is true if AGENTS.md section 0
 * was filled in (false if skipped — non-TTY or explicit --no-prompt — or if
 * the target has no AGENTS.md at all); `mod` is the final enable/disable
 * decision (always a boolean — defaults to false when nothing says otherwise).
 */
export async function guideAgentsSetup(target, { skip = false, projectNameHint, modFlag } = {}) {
  const agentsPath = join(target, 'AGENTS.md');
  const hasAgents = existsSync(agentsPath);

  if (skip || !isInteractive()) {
    if (hasAgents) info('\nNon-interactive — AGENTS.md section 0 left blank. Fill it in yourself, or re-run with a TTY.');
    return { configured: false, mod: modFlag === true };
  }

  section('\nProject setup (fills AGENTS.md section 0 — press Enter to accept a default):');
  const rl = makeInterface();
  try {
    if (hasAgents) {
      const name = await ask(rl, 'Name', projectNameHint || '');
      const purpose = await ask(rl, 'Purpose (one line)', '');
      const stack = await ask(rl, 'Stack', '');
      const administrator = await ask(rl, 'Administrator', '');
      const answers = {};
      for (const k of KNOBS) answers[k.key] = await ask(rl, k.label, k.default);

      let text = readText(agentsPath);
      text = text.replace(/(- Name:).*$/m, `$1 ${name}`);
      text = text.replace(/(- Purpose \(one line\):).*$/m, `$1 ${purpose}`);
      text = text.replace(/(- Stack:).*$/m, `$1 ${stack}`);
      text = text.replace(/(- Administrator:).*$/m, `$1 ${administrator}`);
      for (const k of KNOBS) {
        text = text.replace(k.pattern, `$1${answers[k.key]}$3`);
      }
      writeText(agentsPath, text);
    }

    let mod = modFlag;
    if (mod === undefined) {
      const answer = await ask(rl, 'Enable the in-session status mod for Claude Code? (y/N)', 'N');
      mod = /^y(es)?$/i.test(answer.trim());
    }

    return { configured: hasAgents, mod };
  } finally {
    rl.close();
  }
}
