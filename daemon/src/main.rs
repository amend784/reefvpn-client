mod firewall;
mod ipc;
mod service;
mod singbox;
mod types;

use log::{error, info};

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    info!("ReefVPN Daemon v1.0.0 starting…");

    let args: Vec<String> = std::env::args().collect();
    let flag = args.get(1).map(|s| s.as_str());

    match flag {
        // ── Developer / testing: run as a regular process ─────────────────
        Some("--standalone") => {
            service::run_standalone();
        }

        // ── Service management ────────────────────────────────────────────
        Some("--install") => {
            if let Err(e) = service::install_service() {
                error!("Install failed: {}", e);
                std::process::exit(1);
            }
        }

        Some("--uninstall") => {
            if let Err(e) = service::uninstall_service() {
                error!("Uninstall failed: {}", e);
                std::process::exit(1);
            }
        }

        // ── Production default: hand control to the SCM ───────────────────
        _ => {
            service::run_as_service();
        }
    }
}
