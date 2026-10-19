//! A message the person can see, for the cases where this program has no window to show: it was opened by hand,
//! or the webview could not be created. The program has no console on Windows, so without this it would fail in silence.

/// Shows `message` in a native dialog titled `title`. Falls back to stderr where there is no dialog to use.
pub fn alert(title: &str, message: &str) {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONINFORMATION, MB_OK, MessageBoxW};
        let wide = |s: &str| {
            s.encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<u16>>()
        };
        let (t, m) = (wide(title), wide(message));
        // SAFETY: both buffers are NUL-terminated UTF-16 that outlive the call; a null owner window is allowed.
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                m.as_ptr(),
                t.as_ptr(),
                MB_OK | MB_ICONINFORMATION,
            );
        }
    }
    #[cfg(target_os = "macos")]
    {
        let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            r#"display dialog "{}" with title "{}" buttons {{"OK"}} default button "OK""#,
            esc(message),
            esc(title)
        );
        let _ = std::process::Command::new("osascript")
            .args(["-e", &script])
            .status();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    eprintln!("{title}: {message}");
}

/// What to say when the program is opened by hand instead of by `node scripts/ai-dash-app.mjs`.
pub fn opened_by_hand(version: &str) -> String {
    format!(
        "This is the AI Dash desktop window, version {version}. It is opened by AI Dash, not by hand.\n\n\
         In your project's folder run:\n\n    node scripts/ai-dash-app.mjs\n\n\
         That starts the dashboard and opens it here. It needs the project's scripts and Node, and it downloads and updates this program itself."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hand_opened_message_names_the_command_to_run() {
        let m = opened_by_hand("0.1.1");
        assert!(m.contains("node scripts/ai-dash-app.mjs"));
        assert!(m.contains("0.1.1"));
    }
}
