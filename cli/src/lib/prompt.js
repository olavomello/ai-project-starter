import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export function isInteractive() {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

export async function ask(rl, question, def) {
  const suffix = def ? ` (${def})` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || def || '';
}

export function makeInterface() {
  return createInterface({ input: stdin, output: stdout });
}
