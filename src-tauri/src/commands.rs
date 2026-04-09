use crate::ipc_client;
use crate::types::{ConnectParams, StatusResponse};

/// Connect to a VPN server via the daemon.
#[tauri::command]
pub async fn vpn_connect(params: ConnectParams) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let server_name = params.server.name.clone();
        ipc_client::connect(&params)
            .map(|_| format!("Connected to {}", server_name))
    })
    .await
    .map_err(|e| format!("task join error: {}", e))?
}

/// Disconnect from the VPN via the daemon.
#[tauri::command]
pub async fn vpn_disconnect() -> Result<String, String> {
    tokio::task::spawn_blocking(|| ipc_client::disconnect())
        .await
        .map_err(|e| format!("task join error: {}", e))?
}

/// Query the current VPN status from the daemon.
#[tauri::command]
pub async fn vpn_status() -> Result<StatusResponse, String> {
    tokio::task::spawn_blocking(|| ipc_client::status())
        .await
        .map_err(|e| format!("task join error: {}", e))?
}

/// Measure TCP ping to a server (host:port).
#[tauri::command]
pub async fn measure_ping(host: String, port: u16) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || {
        use std::net::{TcpStream, ToSocketAddrs};
        use std::time::{Duration, Instant};

        let addr = format!("{}:{}", host, port);
        let socket_addr = addr
            .to_socket_addrs()
            .map_err(|e| format!("resolve: {}", e))?
            .next()
            .ok_or("no address")?;

        let start = Instant::now();
        let stream = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(5))
            .map_err(|e| format!("connect: {}", e))?;
        drop(stream);
        let ms = start.elapsed().as_millis() as u64;
        // TCP connect can report 0ms on fast local networks; show at least 1ms
        Ok(ms.max(1))
    })
    .await
    .map_err(|e| format!("task: {}", e))?
}

/// Enable or disable launch at Windows startup via the HKCU Run registry key.
#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        if enabled {
            Command::new("reg")
                .args([
                    "add",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v", "ReefVPN",
                    "/t", "REG_SZ",
                    "/d", &exe.to_string_lossy(),
                    "/f",
                ])
                .output()
                .map_err(|e| e.to_string())?;
        } else {
            Command::new("reg")
                .args([
                    "delete",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v", "ReefVPN",
                    "/f",
                ])
                .output()
                .ok();
        }
    }
    Ok(())
}
