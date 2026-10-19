// A small window for AI Dash. It shows the project's local dashboard (served by scripts/ai-dash.mjs), keeps a
// tray icon and raises native notifications the page asks for. It has no file access and no server of its own:
// all the logic stays in the Node scripts. See docs/adr/0005 in the starter for why it is built this way.
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod args;
mod msg;

use std::time::{Duration, Instant};

use args::Origin;
use msg::Msg;
use tao::dpi::LogicalSize;
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::{Icon, WindowBuilder};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use wry::{NewWindowResponse, WebContext, WebViewBuilder};

const ICON_RGBA: &[u8] = include_bytes!("../assets/icon.rgba");
const ICON_SIZE: u32 = 32;
const VERSION: &str = env!("CARGO_PKG_VERSION");
const SELFTEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug)]
enum UserEvent {
    Tray(TrayIconEvent),
    Menu(MenuEvent),
    Page(Msg),
    SelfTestTimeout,
}

/// What the page may call. Frozen, and every argument is clipped on both sides.
fn init_script(selftest: bool) -> String {
    let mut js = format!(
        r#"(() => {{
  if (window.aiDashDesktop) return;
  const post = (m) => window.ipc.postMessage(JSON.stringify(m));
  window.aiDashDesktop = Object.freeze({{
    apiVersion: 1,
    version: "{VERSION}",
    notify: (title, body) => post({{ t: "notify", title: String(title || "").slice(0, 120), body: String(body || "").slice(0, 300) }}),
    setStatus: (s) => post({{ t: "status", running: Number(s && s.running) || 0, decisions: Number(s && s.decisions) || 0 }}),
  }});
"#
    );
    if selftest {
        // Raise one toast, then report what the page looks like once it has had time to load its data; the shell exits.
        js.push_str(
            r#"  setTimeout(() => window.aiDashDesktop.notify("AI Dash self-test", "Notifications work."), 800);
  window.addEventListener("load", () => setTimeout(() => post({
    t: "selftest",
    title: document.title,
    hasApi: !!window.aiDashDesktop,
    tiles: document.querySelectorAll(".tile").length,
  }), 3500));
"#,
        );
    }
    js.push_str("})();");
    js
}

/// Hands a plain web link to the default browser. No shell is involved, and only http(s) links are accepted.
fn open_external(url: &str) {
    if !args::external_ok(url) {
        return;
    }
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

/// Raises a native notification; true when the system accepted it.
fn notify(title: &str, body: &str) -> bool {
    notify_rust::Notification::new()
        .appname("AI Dash")
        .summary(title)
        .body(body)
        .show()
        .is_ok()
}

fn write_selftest(path: &str, text: &str) {
    let _ = std::fs::write(path, text);
}

fn main() {
    let args = match args::parse(std::env::args().skip(1)) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("ai-dash-desktop {VERSION}: {e}");
            std::process::exit(2);
        }
    };
    let base: Origin = args::origin_of(&args.url).expect("checked by args::parse");
    let selftest = args.selftest_out.clone();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy: EventLoopProxy<UserEvent> = event_loop.create_proxy();

    let icon = Icon::from_rgba(ICON_RGBA.to_vec(), ICON_SIZE, ICON_SIZE)
        .expect("embedded icon is 32x32 RGBA");
    let window = WindowBuilder::new()
        .with_title(&args.title)
        .with_inner_size(LogicalSize::new(1360.0, 900.0))
        .with_min_inner_size(LogicalSize::new(900.0, 600.0))
        .with_window_icon(Some(icon))
        .build(&event_loop)
        .expect("could not create the window");

    let ipc_proxy = proxy.clone();
    let ipc_base = base.clone();
    let nav_base = base.clone();
    // The webview keeps its profile (local storage: the theme, the notification switch) in a folder the launcher
    // chooses, shared by every version of the shell. Left alone, WebView2 would put it next to the executable,
    // inside a version folder that an update deletes.
    let mut web_context = WebContext::new(args.data_dir.as_ref().map(std::path::PathBuf::from));
    let webview = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_url(&args.url)
        .with_initialization_script(init_script(selftest.is_some()))
        .with_devtools(cfg!(debug_assertions))
        // Only the dash's own origin may talk to the shell, and only the dash's own origin may be shown.
        .with_ipc_handler(move |req| {
            if args::navigation_allowed(&ipc_base, &req.uri().to_string())
                && let Some(m) = msg::parse(req.body())
            {
                let _ = ipc_proxy.send_event(UserEvent::Page(m));
            }
        })
        .with_navigation_handler(move |url| {
            if args::navigation_allowed(&nav_base, &url) {
                return true;
            }
            open_external(&url);
            false
        })
        .with_new_window_req_handler(|url, _| {
            open_external(&url);
            NewWindowResponse::Deny
        })
        .build(&window);
    let webview = match webview {
        Ok(w) => w,
        Err(e) => {
            // Most often: the WebView2 runtime is missing. The launcher sees the exit code and falls back to the browser.
            if let Some(path) = &selftest {
                write_selftest(
                    path,
                    &format!(r#"{{"ok":false,"error":{:?}}}"#, e.to_string()),
                );
            }
            eprintln!("ai-dash-desktop {VERSION}: could not create the webview: {e}");
            std::process::exit(3);
        }
    };
    let _webview = webview;

    // The tray menu and its events are forwarded into the event loop so it wakes up for each of them.
    let tray_proxy = proxy.clone();
    TrayIconEvent::set_event_handler(Some(move |e| {
        let _ = tray_proxy.send_event(UserEvent::Tray(e));
    }));
    let menu_proxy = proxy.clone();
    MenuEvent::set_event_handler(Some(move |e| {
        let _ = menu_proxy.send_event(UserEvent::Menu(e));
    }));

    let item_toggle = MenuItem::new("Show / hide", true, None);
    let item_browser = MenuItem::new("Open in browser", true, None);
    let item_quit = MenuItem::new("Quit", true, None);
    let (id_toggle, id_browser, id_quit) = (
        item_toggle.id().clone(),
        item_browser.id().clone(),
        item_quit.id().clone(),
    );
    let menu = Menu::new();
    let _ = menu.append_items(&[
        &item_toggle,
        &item_browser,
        &PredefinedMenuItem::separator(),
        &item_quit,
    ]);

    let tray_icon = tray_icon::Icon::from_rgba(ICON_RGBA.to_vec(), ICON_SIZE, ICON_SIZE)
        .expect("embedded icon");
    let mut tray = None;
    let title_for_tray = args.title.clone();
    let tooltip_title = args.title.clone();
    let tooltip = move |running: u32| -> String {
        if running == 0 {
            tooltip_title.clone()
        } else {
            format!("{tooltip_title} - {running} running")
        }
    };
    let url = args.url.clone();

    if selftest.is_some() {
        let p = proxy.clone();
        std::thread::spawn(move || {
            std::thread::sleep(SELFTEST_TIMEOUT);
            let _ = p.send_event(UserEvent::SelfTestTimeout);
        });
    }

    let mut last_toasts: Vec<Instant> = Vec::new();
    let mut notified: Option<bool> = None;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::NewEvents(StartCause::Init) => {
                tray = TrayIconBuilder::new()
                    .with_menu(Box::new(menu.clone()))
                    .with_menu_on_left_click(false)
                    .with_tooltip(&title_for_tray)
                    .with_icon(tray_icon.clone())
                    .build()
                    .ok();
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => *control_flow = ControlFlow::Exit,
            Event::UserEvent(UserEvent::Tray(TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. })) => {
                window.set_visible(true);
                window.set_focus();
            }
            Event::UserEvent(UserEvent::Menu(e)) => {
                if e.id == id_quit {
                    *control_flow = ControlFlow::Exit;
                } else if e.id == id_browser {
                    open_external(&url);
                } else if e.id == id_toggle {
                    if window.is_visible() {
                        window.set_visible(false);
                    } else {
                        window.set_visible(true);
                        window.set_focus();
                    }
                }
            }
            Event::UserEvent(UserEvent::Page(m)) => match m {
                Msg::Notify { title, body } => {
                    // A buggy page must not be able to flood the desktop: five toasts per ten seconds at most.
                    let now = Instant::now();
                    last_toasts.retain(|t| now.duration_since(*t) < Duration::from_secs(10));
                    if last_toasts.len() < 5 {
                        last_toasts.push(now);
                        notified = Some(notify(&title, &body));
                    }
                }
                Msg::Status { running, .. } => {
                    if let Some(t) = &tray {
                        let _ = t.set_tooltip(Some(tooltip(running)));
                    }
                }
                Msg::SelfTest { title, has_api, tiles } => {
                    if let Some(path) = &selftest {
                        let toast = match notified { Some(ok) => ok.to_string(), None => "null".to_string() };
                        write_selftest(path, &format!(r#"{{"ok":true,"version":"{VERSION}","title":{title:?},"hasApi":{has_api},"tiles":{tiles},"notified":{toast}}}"#));
                    }
                    *control_flow = ControlFlow::Exit;
                }
            },
            Event::UserEvent(UserEvent::SelfTestTimeout) => {
                if let Some(path) = &selftest {
                    write_selftest(path, r#"{"ok":false,"error":"the page did not report in time"}"#);
                }
                std::process::exit(4);
            }
            _ => {}
        }
    });
}
