# AI Dash desktop shell

A small native window for [AI Dash](../template/ai-dash/README.md): it shows the project's local dashboard, keeps a tray icon and raises system notifications. It has no logic of its own. The dashboard, the server and every rule stay in the Node scripts of each project; this program only hosts a webview. Why it is built this way: [ADR 0005](../template/docs/adr/0005-offer-ai-dash-as-a-small-desktop-window-downloaded-on-first-use.md).

You do not install it by hand. In a project:

```bash
node scripts/ai-dash-app.mjs
```

downloads the shell once per machine (about 0.6 MB on Windows; while the repository is private it uses `GH_TOKEN` or your `gh` login to do so), checks its SHA-256, and opens the window. Later runs download nothing; a newer shell is fetched in the background at most once a day. Without a release, offline, or with `--no-shell`, the same command opens Edge or Chrome in app mode (a window without tabs or address bar) and, failing that, the default browser.

## What it does

- One window per project, titled `AI Dash - <project>`, loading `http://127.0.0.1:<port>/` from the project's own server.
- A tray icon: click to show the window; the menu has Show / hide, Open in browser and Quit. The tooltip shows how many agents are running.
- Native notifications asked for by the page: an agent finished, pending decisions grew (a switch in AI Dash's Settings turns them off).
- Opened by hand (double-click) it shows a short message with the command to run, and if the webview cannot be created (usually the WebView2 runtime is missing) it says so in a dialog; the launcher passes `--no-alert` and reports such failures itself, with the shell's last error taken from `shell.log` in the cache folder.
- Navigation is locked to the dash's own origin; any other link opens in the default browser and no second window is created.

The page talks to it through one object, `window.aiDashDesktop` (`apiVersion`, `version`, `notify(title, body)`, `setStatus({ running, decisions })`), which the shell injects. Only the dash's own origin can send it messages, and each message is size-limited and type-checked (`src/msg.rs`).

## Command line

The launcher passes these; they are listed for completeness.

```text
ai-dash-desktop --url http://127.0.0.1:4412/ --title "AI Dash - demo" --project D:\work\demo
                [--data-dir <folder for the webview profile>] [--selftest-out <file>] [--no-alert]
```

The URL must be plain `http` on a loopback address. `--selftest-out` makes the shell write a JSON report (page title, whether the bridge is there, tile count, whether a notification was accepted) and exit; it is how the build is checked on a real machine.

## Build and test

```bash
cd desktop
cargo test                      # the argument and message rules
cargo build --release           # target/release/ai-dash-desktop(.exe)
node scripts/make-icon.mjs      # only when the icon changes: writes assets/icon.rgba
```

Needs Rust (stable) and, on Windows, the MSVC build tools; the WebView2 runtime ships with Windows 10/11. Release profile is size-first (`opt-level = "z"`, LTO, stripped).

## Releases

CI builds Windows x64 and macOS (arm64, x64) from `.github/workflows/desktop.yml`. A tag `desktop-vX.Y.Z` that matches the `version` in `Cargo.toml` publishes a GitHub Release with the binaries, `latest.json` (name, URL, size and SHA-256 per platform, read by the launcher) and `SHA256SUMS`. To build without publishing, run the workflow by hand: the binaries stay as artifacts of the run.

```bash
# bump version in desktop/Cargo.toml first, commit, then:
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

The binaries are not code-signed. macOS gets an ad-hoc signature (Apple Silicon refuses unsigned code). macOS is built but has not been tested yet.
