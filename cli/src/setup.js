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
];

/**
 * Interactively fills AGENTS.md section 0 (Name, Purpose, Stack, Administrator,
 * knobs) in `target` right after the template is copied, so the initial commit
 * already has a real project identity instead of the template's blanks.
 *
 * Returns true if it wrote anything, false if it was skipped (non-TTY or
 * explicit --no-prompt).
 */
export async function guideAgentsSetup(target, { skip = false, projectNameHint } = {}) {
  const agentsPath = join(target, 'AGENTS.md');
  if (!existsSync(agentsPath)) return false;

  if (skip || !isInteractive()) {
    info('\nNon-interactive — AGENTS.md section 0 left blank. Fill it in yourself, or re-run with a TTY.');
    return false;
  }

  section('\nProject setup (fills AGENTS.md section 0 — press Enter to accept a default):');
  const rl = makeInterface();
  try {
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
    return true;
  } finally {
    rl.close();
  }
}
