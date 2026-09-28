export function die(msg) {
  console.error(`ai-project-starter: ${msg}`);
  process.exit(1);
}
export function warn(msg) { console.error(`  ! ${msg}`); }
export function ok(msg) { console.log(`  ok  ${msg}`); }
export function info(msg) { console.log(msg); }
export function section(title) { console.log(`\n${title}`); }
