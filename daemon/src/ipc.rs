use crate::firewall;
use crate::singbox::SingBoxManager;
use crate::types::*;
use log::{error, info, warn};
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[cfg(windows)]
use std::os::windows::io::FromRawHandle;

// ── Maximum auto-reconnect attempts before giving up ────────────────────────
const MAX_RECONNECT_ATTEMPTS: u32 = 3;
// ── How often the monitor polls sing-box health (seconds) ────────────────────
const MONITOR_INTERVAL_SECS: u64 = 5;

// ── Daemon state ─────────────────────────────────────────────────────────────

pub struct DaemonState {
    pub singbox: SingBoxManager,
    pub connection_state: Mutex<ConnectionState>,
    pub connected_server: Mutex<Option<String>>,
    pub connected_protocol: Mutex<Option<String>>,
    pub connected_at: Mutex<Option<Instant>>,
    /// Last successful ConnectRequest – used by the auto-reconnect monitor.
    pub last_request: Mutex<Option<ConnectRequest>>,
    /// Number of consecutive failed reconnect attempts.
    pub reconnect_attempts: Mutex<u32>,
}

impl DaemonState {
    pub fn new() -> Self {
        Self {
            singbox: SingBoxManager::new(),
            connection_state: Mutex::new(ConnectionState::Disconnected),
            connected_server: Mutex::new(None),
            connected_protocol: Mutex::new(None),
            connected_at: Mutex::new(None),
            last_request: Mutex::new(None),
            reconnect_attempts: Mutex::new(0),
        }
    }

    pub fn get_status(&self) -> StatusResponse {
        let state = self.connection_state.lock().unwrap().clone();
        let server = self.connected_server.lock().unwrap().clone();
        let protocol = self.connected_protocol.lock().unwrap().clone();
        let uptime = self
            .connected_at
            .lock()
            .unwrap()
            .map(|t| t.elapsed().as_secs());

        StatusResponse {
            state,
            server,
            protocol,
            ip: None, // TODO: fetch external IP
            uptime_secs: uptime,
        }
    }

    /// Resolve mode to a list of (protocol, transport) pairs to try in order.
    fn resolve_mode_fallback(mode: &str) -> Vec<(&'static str, &'static str)> {
        match mode {
            "fast" => vec![("wireguard", "")],
            "stable" => vec![("wireguard", ""), ("vless", "raw")],
            "antiblock" => vec![("vless", "raw"), ("vless", "grpc"), ("vless", "xhttp")],
            _ => vec![("wireguard", ""), ("vless", "raw"), ("vless", "grpc")], // auto
        }
    }

    pub fn connect(&self, req: ConnectRequest) -> Result<(), String> {
        *self.connection_state.lock().unwrap() = ConnectionState::Connecting;

        // If mode is set, try fallback chain
        let mode = req.mode.as_deref().unwrap_or("");
        let fallback_chain = if !mode.is_empty() && mode != "fast" && mode != "antiblock" {
            Self::resolve_mode_fallback(mode)
        } else {
            // Direct connect with specified protocol
            vec![(req.protocol.as_str(), req.transport.as_str())]
        };

        // For mode-based: if protocol already set explicitly, use it directly
        let chain: Vec<(String, String)> = if req.protocol.is_empty() || req.mode.is_some() {
            Self::resolve_mode_fallback(req.mode.as_deref().unwrap_or("auto"))
                .into_iter()
                .map(|(p, t)| (p.to_string(), t.to_string()))
                .collect()
        } else {
            vec![(req.protocol.clone(), req.transport.clone())]
        };

        let mut last_err = String::new();
        for (proto, transport) in &chain {
            let mut attempt = req.clone();
            attempt.protocol = proto.clone();
            attempt.transport = transport.clone();

            // Set correct port for transport
            if proto == "vless" {
                match transport.as_str() {
                    "grpc" => {
                        if attempt.server.port == 51820 || attempt.server.port == 0 {
                            attempt.server.port = 7443;
                        }
                    }
                    "xhttp" => {
                        if attempt.server.port == 51820 || attempt.server.port == 0 {
                            attempt.server.port = 9443;
                        }
                    }
                    _ => {
                        if attempt.server.port == 51820 || attempt.server.port == 0 {
                            attempt.server.port = 443;
                        }
                    }
                }
            }

            info!("Trying {}/{} to {}...", proto, transport, req.server.name);

            match self.singbox.start(&attempt) {
                Ok(()) => {
                    *self.connection_state.lock().unwrap() = ConnectionState::Connected;
                    *self.connected_server.lock().unwrap() = Some(req.server.name.clone());
                    *self.connected_protocol.lock().unwrap() =
                        Some(format!("{}/{}", proto, transport));
                    *self.connected_at.lock().unwrap() = Some(Instant::now());
                    *self.last_request.lock().unwrap() = Some(attempt);
                    *self.reconnect_attempts.lock().unwrap() = 0;

                    if req.kill_switch.unwrap_or(true) {
                        if let Err(e) = firewall::enable_killswitch() {
                            warn!("WFP kill switch failed (non-fatal): {}", e);
                        }
                    }

                    info!("Connected to {} via {}/{}", req.server.name, proto, transport);
                    return Ok(());
                }
                Err(e) => {
                    warn!("Failed {}/{}: {}", proto, transport, e);
                    last_err = e;
                    self.singbox.stop().ok();
                    // Try next in chain
                }
            }
        }

        *self.connection_state.lock().unwrap() = ConnectionState::Error;
        error!("All connection attempts failed. Last error: {}", last_err);
        Err(format!("Connection failed after trying all modes: {}", last_err))
    }

    pub fn disconnect(&self) -> Result<(), String> {
        *self.connection_state.lock().unwrap() = ConnectionState::Disconnecting;
        // Disable WFP kill switch before stopping VPN
        firewall::disable_killswitch().ok();
        self.singbox.stop()?;
        *self.connection_state.lock().unwrap() = ConnectionState::Disconnected;
        *self.connected_server.lock().unwrap() = None;
        *self.connected_protocol.lock().unwrap() = None;
        *self.connected_at.lock().unwrap() = None;
        // Clear stored request so the monitor does not try to reconnect
        *self.last_request.lock().unwrap() = None;
        *self.reconnect_attempts.lock().unwrap() = 0;
        info!("Disconnected");
        Ok(())
    }

    pub fn handle_rpc(&self, request: RpcRequest) -> RpcResponse {
        let id = request.id;

        match request.method.as_str() {
            "status" => {
                let status = self.get_status();
                RpcResponse {
                    result: Some(serde_json::to_value(status).unwrap()),
                    error: None,
                    id,
                }
            }
            "connect" => {
                let req: ConnectRequest = match request.params {
                    Some(p) => match serde_json::from_value(p) {
                        Ok(r) => r,
                        Err(e) => {
                            return RpcResponse {
                                result: None,
                                error: Some(format!("invalid params: {}", e)),
                                id,
                            }
                        }
                    },
                    None => {
                        return RpcResponse {
                            result: None,
                            error: Some("params required".into()),
                            id,
                        }
                    }
                };

                match self.connect(req) {
                    Ok(()) => RpcResponse {
                        result: Some(serde_json::json!({"status": "connected"})),
                        error: None,
                        id,
                    },
                    Err(e) => RpcResponse {
                        result: None,
                        error: Some(e),
                        id,
                    },
                }
            }
            "disconnect" => match self.disconnect() {
                Ok(()) => RpcResponse {
                    result: Some(serde_json::json!({"status": "disconnected"})),
                    error: None,
                    id,
                },
                Err(e) => RpcResponse {
                    result: None,
                    error: Some(e),
                    id,
                },
            },
            _ => RpcResponse {
                result: None,
                error: Some(format!("unknown method: {}", request.method)),
                id,
            },
        }
    }
}

// ── Auto-reconnect monitor (Task 6) ─────────────────────────────────────────

/// Spawns a background thread that monitors sing-box every `MONITOR_INTERVAL_SECS`
/// seconds.  If sing-box dies while the logical state is `Connected`, it
/// automatically attempts to restart it using the last `ConnectRequest`.
/// After `MAX_RECONNECT_ATTEMPTS` consecutive failures the state is set to
/// `Error` and no further retries are made.
pub fn start_reconnect_monitor(state: Arc<DaemonState>) {
    std::thread::spawn(move || {
        info!(
            "Auto-reconnect monitor started (interval={}s, max_attempts={})",
            MONITOR_INTERVAL_SECS, MAX_RECONNECT_ATTEMPTS
        );

        loop {
            std::thread::sleep(std::time::Duration::from_secs(MONITOR_INTERVAL_SECS));

            let current_state = state.connection_state.lock().unwrap().clone();

            // Only act when we believe we should be connected
            if current_state != ConnectionState::Connected {
                continue;
            }

            // Is sing-box still alive?
            if state.singbox.is_running() {
                continue;
            }

            // sing-box died unexpectedly
            warn!("sing-box process died unexpectedly – attempting reconnect…");

            let req_opt = state.last_request.lock().unwrap().clone();
            let req = match req_opt {
                Some(r) => r,
                None => {
                    warn!("No last ConnectRequest stored – cannot reconnect");
                    *state.connection_state.lock().unwrap() = ConnectionState::Error;
                    continue;
                }
            };

            let attempts = {
                let mut a = state.reconnect_attempts.lock().unwrap();
                *a += 1;
                *a
            };

            if attempts > MAX_RECONNECT_ATTEMPTS {
                error!(
                    "sing-box died and {} reconnect attempts exhausted – giving up",
                    MAX_RECONNECT_ATTEMPTS
                );
                *state.connection_state.lock().unwrap() = ConnectionState::Error;
                continue;
            }

            info!(
                "Reconnect attempt {}/{} to {}…",
                attempts, MAX_RECONNECT_ATTEMPTS, req.server.name
            );

            // Transition to Connecting so the GUI can reflect that
            *state.connection_state.lock().unwrap() = ConnectionState::Connecting;

            match state.singbox.start(&req) {
                Ok(()) => {
                    *state.connection_state.lock().unwrap() = ConnectionState::Connected;
                    *state.connected_at.lock().unwrap() = Some(Instant::now());
                    *state.reconnect_attempts.lock().unwrap() = 0;
                    info!("Reconnect successful");
                }
                Err(e) => {
                    error!("Reconnect attempt {} failed: {}", attempts, e);
                    if attempts >= MAX_RECONNECT_ATTEMPTS {
                        error!("Max reconnect attempts reached – setting state to Error");
                        *state.connection_state.lock().unwrap() = ConnectionState::Error;
                    } else {
                        // Leave in Connecting; next iteration will try again
                        *state.connection_state.lock().unwrap() = ConnectionState::Connecting;
                    }
                }
            }
        }
    });
}

// ── Named pipe server (Windows) ──────────────────────────────────────────────

/// Start named pipe server (Windows).
/// Each client connection is handled synchronously in a dedicated thread so
/// multiple GUI windows / CLI callers can coexist.
#[cfg(windows)]
pub fn start_pipe_server(state: Arc<DaemonState>) {
    use std::ptr;
    use windows_sys::Win32::Storage::FileSystem::*;
    use windows_sys::Win32::System::Pipes::*;

    let pipe_name = b"\\\\.\\pipe\\ReefVPN\0";

    info!("Starting named pipe server at \\\\.\\pipe\\ReefVPN");

    // Start the reconnect monitor
    start_reconnect_monitor(Arc::clone(&state));

    loop {
        // SAFETY: all Windows API calls below are safe when called with the
        // documented constraints.  The raw handle is wrapped in a File before
        // crossing the thread boundary via `SendableHandle` which guarantees
        // exclusive ownership.
        unsafe {
            let pipe = CreateNamedPipeA(
                pipe_name.as_ptr(),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                10, // max instances
                4096,
                4096,
                0,
                ptr::null_mut(),
            );

            if pipe == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
                error!("Failed to create named pipe");
                std::thread::sleep(std::time::Duration::from_secs(1));
                continue;
            }

            // Wait for a client to connect
            let connected = ConnectNamedPipe(pipe, ptr::null_mut());
            if connected == 0 {
                // GetLastError() == ERROR_PIPE_CONNECTED (535) is actually OK
                let err = windows_sys::Win32::Foundation::GetLastError();
                if err != 535 {
                    error!("ConnectNamedPipe failed: {}", err);
                    windows_sys::Win32::Foundation::CloseHandle(pipe);
                    continue;
                }
            }

            info!("Client connected to pipe");

            // `HANDLE` is `*mut c_void` which is !Send.  Store it as `usize`
            // (the raw address) to cross the thread boundary safely.
            // SAFETY: we guarantee exclusive ownership of `pipe`; no other code
            // will use the handle value after this assignment.
            let pipe_as_usize = pipe as usize;
            let state_clone = Arc::clone(&state);

            std::thread::spawn(move || {
                // Reconstruct the handle from its integer value.
                let pipe = pipe_as_usize as *mut std::ffi::c_void;
                // Safety: we own `pipe` exclusively; File takes ownership.
                let file = std::fs::File::from_raw_handle(pipe);
                let reader = BufReader::new(&file);
                let mut writer = &file;

                for line in reader.lines() {
                    match line {
                        Ok(line) if !line.is_empty() => {
                            match serde_json::from_str::<RpcRequest>(&line) {
                                Ok(req) => {
                                    let resp = state_clone.handle_rpc(req);
                                    let resp_json =
                                        serde_json::to_string(&resp).unwrap();
                                    let _ = writeln!(writer, "{}", resp_json);
                                }
                                Err(e) => {
                                    let resp = RpcResponse {
                                        result: None,
                                        error: Some(format!("parse error: {}", e)),
                                        id: None,
                                    };
                                    let resp_json =
                                        serde_json::to_string(&resp).unwrap();
                                    let _ = writeln!(writer, "{}", resp_json);
                                }
                            }
                        }
                        Err(_) => break,
                        _ => {}
                    }
                }

                info!("Client disconnected from pipe");
                // `file` drop closes the handle
            });
        }
    }
}

/// Fallback for non-Windows: TCP on localhost.
#[cfg(not(windows))]
pub fn start_pipe_server(state: Arc<DaemonState>) {
    use std::net::TcpListener;

    // Start the reconnect monitor
    start_reconnect_monitor(Arc::clone(&state));

    let listener = TcpListener::bind("127.0.0.1:19876").expect("failed to bind");
    info!("Starting TCP IPC server on 127.0.0.1:19876");

    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            let state_clone = Arc::clone(&state);
            std::thread::spawn(move || {
                let reader = BufReader::new(&stream);
                let mut writer = &stream;

                for line in reader.lines() {
                    match line {
                        Ok(line) if !line.is_empty() => {
                            if let Ok(req) = serde_json::from_str::<RpcRequest>(&line) {
                                let resp = state_clone.handle_rpc(req);
                                let resp_json = serde_json::to_string(&resp).unwrap();
                                let _ = writeln!(writer, "{}", resp_json);
                            }
                        }
                        _ => break,
                    }
                }
            });
        }
    }
}
