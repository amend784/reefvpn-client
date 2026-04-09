mod commands;
mod ipc_client;
mod types;

use std::process::Command;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // ── Start daemon if not already running ──────────────────────
            start_daemon_if_needed();
            // ── System tray (right-click menu only) ───────────────────────
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit ReefVPN", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("ReefVPN")
                .on_tray_icon_event(|tray, event| {
                    // Left click toggles window
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                window.hide().ok();
                            } else {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().ok();
                            window.set_focus().ok();
                        }
                    }
                    "quit" => {
                        // Disconnect VPN before quitting
                        let _ = ipc_client::disconnect();
                        // Kill daemon process
                        #[cfg(windows)]
                        { let _ = Command::new("taskkill").args(["/IM", "reefvpn-daemon.exe", "/F"]).output(); }
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // ── Window positioning (bottom-right, near tray) ───────────────
            if let Some(window) = app.get_webview_window("main") {
                // Hide from taskbar — only show in tray
                window.set_skip_taskbar(true).ok();

                if let Ok(Some(monitor)) = window.current_monitor() {
                    let size = monitor.size();
                    let scale = monitor.scale_factor();
                    let win_width = (320.0 * scale) as i32;
                    let win_height = (580.0 * scale) as i32;
                    let margin = (12.0 * scale) as i32;
                    let taskbar = (48.0 * scale) as i32;
                    let x = size.width as i32 - win_width - margin;
                    let y = size.height as i32 - win_height - margin - taskbar;
                    window
                        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
                        .ok();
                }

                window.show().ok();
                window.set_focus().ok();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close button hides to tray instead of quitting
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window.hide().ok();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::vpn_connect,
            commands::vpn_disconnect,
            commands::vpn_status,
            commands::measure_ping,
            commands::set_autostart,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|_app, _event| {
            // VPN managed by daemon — no cleanup needed on GUI exit
        });
}

/// Start the daemon process if it's not already running.
/// Checks if the named pipe exists (daemon is alive), and if not,
/// launches reefvpn-daemon.exe in standalone mode.
fn start_daemon_if_needed() {
    // Quick check: try to open the named pipe
    #[cfg(windows)]
    {
        use std::fs::OpenOptions;
        if OpenOptions::new()
            .read(true)
            .write(true)
            .open(r"\\.\pipe\ReefVPN")
            .is_ok()
        {
            // Daemon is already running
            return;
        }
    }

    // Find daemon binary next to our exe
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();

    let candidates = [
        exe_dir.join("reefvpn-daemon.exe"),
        exe_dir.join("resources").join("reefvpn-daemon.exe"),
        exe_dir.join("_up_").join("resources").join("reefvpn-daemon.exe"),
        std::path::PathBuf::from(r"C:\Program Files\ReefVPN\reefvpn-daemon.exe"),
        std::path::PathBuf::from(r"C:\Program Files\ReefVPN\resources\reefvpn-daemon.exe"),
    ];

    for daemon_path in &candidates {
        if daemon_path.exists() {
            #[cfg(windows)]
            use std::os::windows::process::CommandExt;

            let mut cmd = Command::new(daemon_path);
            cmd.arg("--standalone");

            #[cfg(windows)]
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

            if let Ok(_) = cmd.spawn() {
                // Give daemon a moment to start the pipe server
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            return;
        }
    }
}
