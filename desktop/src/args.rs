//! The command line, and the rules for which addresses the window may show or open.

/// What the launcher passes: the dash to show, a window title, and the project folder.
#[derive(Debug, PartialEq)]
pub struct Args {
    pub url: String,
    pub title: String,
    pub project: String,
    pub data_dir: Option<String>,
    pub selftest_out: Option<String>,
    /// Errors go to the exit code only, not to a dialog (the launcher passes this and reports them itself).
    pub no_alert: bool,
}

/// A web origin: host and port (the scheme is always http for what this window shows).
#[derive(Debug, PartialEq, Clone)]
pub struct Origin {
    pub host: String,
    pub port: u16,
}

/// Parses `--url`, `--title`, `--project`, `--data-dir` and `--selftest-out`. The URL must be plain http on a loopback address.
pub fn parse<I: IntoIterator<Item = String>>(argv: I) -> Result<Args, String> {
    let mut url = None;
    let mut title = None;
    let mut project = None;
    let mut data_dir = None;
    let mut selftest_out = None;
    let mut no_alert = false;
    let mut it = argv.into_iter();
    while let Some(flag) = it.next() {
        if flag == "--no-alert" {
            no_alert = true;
            continue;
        }
        let mut value = || it.next().ok_or_else(|| format!("{flag} needs a value"));
        match flag.as_str() {
            "--url" => url = Some(value()?),
            "--title" => title = Some(value()?),
            "--project" => project = Some(value()?),
            "--data-dir" => data_dir = Some(value()?),
            "--selftest-out" => selftest_out = Some(value()?),
            other => return Err(format!("unknown option {other}")),
        }
    }
    let url = url.ok_or("--url is required")?;
    let origin = origin_of(&url).ok_or("--url must be http://host:port/ ...")?;
    if !is_loopback(&origin.host) {
        return Err(format!(
            "--url must be a loopback address, not {}",
            origin.host
        ));
    }
    let project = project.unwrap_or_default();
    let title = title.unwrap_or_else(|| "AI Dash".to_string());
    Ok(Args {
        url,
        title,
        project,
        data_dir,
        selftest_out,
        no_alert,
    })
}

/// Host and port of an `http://` URL, or None for anything else (other schemes, no port, bad port).
pub fn origin_of(url: &str) -> Option<Origin> {
    let rest = url.strip_prefix("http://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let (h, after) = inner.split_once(']')?;
        (format!("[{h}]"), after.strip_prefix(':')?)
    } else {
        let (h, p) = authority.rsplit_once(':')?;
        (h.to_string(), p)
    };
    let port: u16 = port.parse().ok().filter(|p| *p > 0)?;
    if host.is_empty() {
        return None;
    }
    Some(Origin {
        host: host.to_ascii_lowercase(),
        port,
    })
}

pub fn is_loopback(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

/// The window may navigate only inside the dash's own origin (or to about:blank).
pub fn navigation_allowed(base: &Origin, target: &str) -> bool {
    target == "about:blank" || origin_of(target).as_ref() == Some(base)
}

/// What may be handed to the default browser: plain http(s) links, without whitespace or control characters.
pub fn external_ok(url: &str) -> bool {
    (url.starts_with("http://") || url.starts_with("https://"))
        && url.len() <= 2048
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn parses_the_launchers_arguments() {
        let a = parse(s(&[
            "--url",
            "http://127.0.0.1:4412/",
            "--title",
            "AI Dash - demo",
            "--project",
            "D:/demo",
        ]))
        .unwrap();
        assert_eq!(a.url, "http://127.0.0.1:4412/");
        assert_eq!(a.title, "AI Dash - demo");
        assert_eq!(a.project, "D:/demo");
        assert_eq!(a.selftest_out, None);
        assert_eq!(a.data_dir, None);
        assert!(!a.no_alert);
        let b = parse(s(&[
            "--url",
            "http://localhost:4300/",
            "--selftest-out",
            "out.json",
            "--data-dir",
            "D:/cache/webview",
        ]))
        .unwrap();
        assert_eq!(b.title, "AI Dash");
        assert_eq!(b.selftest_out.as_deref(), Some("out.json"));
        assert_eq!(b.data_dir.as_deref(), Some("D:/cache/webview"));
    }

    #[test]
    fn no_alert_is_a_flag_without_a_value() {
        let a = parse(s(&["--no-alert", "--url", "http://127.0.0.1:4412/"])).unwrap();
        assert!(a.no_alert);
        assert_eq!(a.url, "http://127.0.0.1:4412/");
    }

    #[test]
    fn refuses_a_missing_or_foreign_url() {
        assert!(parse(s(&[])).is_err());
        assert!(parse(s(&["--url", "https://127.0.0.1:4412/"])).is_err());
        assert!(parse(s(&["--url", "http://example.com:80/"])).is_err());
        assert!(
            parse(s(&["--url", "http://127.0.0.1/"])).is_err(),
            "no port"
        );
        assert!(parse(s(&["--url", "http://127.0.0.1:4412/", "--bogus"])).is_err());
        assert!(parse(s(&["--url"])).is_err());
    }

    #[test]
    fn origin_parsing_handles_hosts_ports_and_tricks() {
        assert_eq!(
            origin_of("http://127.0.0.1:4300/x?y#z"),
            Some(Origin {
                host: "127.0.0.1".into(),
                port: 4300
            })
        );
        assert_eq!(
            origin_of("http://LOCALHOST:80"),
            Some(Origin {
                host: "localhost".into(),
                port: 80
            })
        );
        assert_eq!(
            origin_of("http://[::1]:9/"),
            Some(Origin {
                host: "[::1]".into(),
                port: 9
            })
        );
        assert_eq!(origin_of("http://user@127.0.0.1:4300/"), None);
        assert_eq!(origin_of("http://127.0.0.1:0/"), None);
        assert_eq!(origin_of("http://127.0.0.1:99999/"), None);
        assert_eq!(origin_of("file:///etc/passwd"), None);
        assert_eq!(origin_of("javascript:alert(1)"), None);
    }

    #[test]
    fn navigation_stays_on_the_dash_origin() {
        let base = origin_of("http://127.0.0.1:4300/").unwrap();
        assert!(navigation_allowed(&base, "http://127.0.0.1:4300/api/live"));
        assert!(navigation_allowed(&base, "about:blank"));
        assert!(!navigation_allowed(&base, "http://127.0.0.1:4301/"));
        assert!(
            !navigation_allowed(&base, "http://localhost:4300/"),
            "another host name is another origin"
        );
        assert!(!navigation_allowed(&base, "https://example.com/"));
        assert!(!navigation_allowed(
            &base,
            "http://127.0.0.1:4300.evil.test/"
        ));
    }

    #[test]
    fn only_plain_web_links_go_to_the_browser() {
        assert!(external_ok("https://github.com/olavomello"));
        assert!(external_ok("http://example.com/a?b=c"));
        assert!(!external_ok("file:///C:/Windows/system32/calc.exe"));
        assert!(!external_ok("javascript:alert(1)"));
        assert!(!external_ok("https://x.test/ a"));
        assert!(!external_ok("https://x.test/\nb"));
        assert!(!external_ok(&format!(
            "https://x.test/{}",
            "a".repeat(3000)
        )));
    }
}
