//! The messages the page may send to the shell. Anything else is ignored.

#[derive(Debug, PartialEq)]
pub enum Msg {
    Notify {
        title: String,
        body: String,
    },
    Status {
        running: u32,
        decisions: u32,
    },
    SelfTest {
        title: String,
        has_api: bool,
        tiles: u32,
    },
}

fn clip(v: &serde_json::Value, key: &str, max: usize) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .chars()
        .take(max)
        .collect()
}

fn count(v: &serde_json::Value, key: &str) -> u32 {
    v.get(key)
        .and_then(|x| x.as_u64())
        .map(|n| n.min(9999) as u32)
        .unwrap_or(0)
}

/// Parses one message from the page; None when it is not valid JSON, has no known type or has nothing to show.
pub fn parse(text: &str) -> Option<Msg> {
    if text.len() > 4096 {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    match v.get("t")?.as_str()? {
        "notify" => {
            let title = clip(&v, "title", 120);
            if title.trim().is_empty() {
                return None;
            }
            Some(Msg::Notify {
                title,
                body: clip(&v, "body", 300),
            })
        }
        "status" => Some(Msg::Status {
            running: count(&v, "running"),
            decisions: count(&v, "decisions"),
        }),
        "selftest" => Some(Msg::SelfTest {
            title: clip(&v, "title", 200),
            has_api: v.get("hasApi").and_then(|x| x.as_bool()).unwrap_or(false),
            tiles: count(&v, "tiles"),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_three_known_messages() {
        assert_eq!(
            parse(r#"{"t":"notify","title":"dev-web-builder finished","body":"took 3m"}"#),
            Some(Msg::Notify {
                title: "dev-web-builder finished".into(),
                body: "took 3m".into()
            })
        );
        assert_eq!(
            parse(r#"{"t":"status","running":2,"decisions":14}"#),
            Some(Msg::Status {
                running: 2,
                decisions: 14
            })
        );
        assert_eq!(
            parse(r#"{"t":"selftest","title":"Agent Activity","hasApi":true,"tiles":7}"#),
            Some(Msg::SelfTest {
                title: "Agent Activity".into(),
                has_api: true,
                tiles: 7
            })
        );
    }

    #[test]
    fn ignores_everything_else() {
        assert_eq!(parse("not json"), None);
        assert_eq!(parse(r#"{"t":"open-file","path":"C:/x"}"#), None);
        assert_eq!(parse(r#"{"title":"no type"}"#), None);
        assert_eq!(parse(r#"{"t":"notify","title":"   "}"#), None);
        assert_eq!(
            parse(&format!(
                r#"{{"t":"notify","title":"{}"}}"#,
                "x".repeat(5000)
            )),
            None
        );
    }

    #[test]
    fn clips_long_text_and_clamps_counts() {
        let long = "é".repeat(500);
        match parse(&format!(
            r#"{{"t":"notify","title":"{long}","body":"{long}"}}"#
        )) {
            Some(Msg::Notify { title, body }) => {
                assert_eq!(title.chars().count(), 120);
                assert_eq!(body.chars().count(), 300);
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(
            parse(r#"{"t":"status","running":999999999,"decisions":-3}"#),
            Some(Msg::Status {
                running: 9999,
                decisions: 0
            })
        );
    }
}
