use crate::types::{ConnectParams, StatusResponse};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};

#[derive(Serialize)]
struct RpcRequest {
    method: String,
    params: Option<serde_json::Value>,
    id: Option<u64>,
}

#[derive(Deserialize)]
struct RpcResponse {
    result: Option<serde_json::Value>,
    error: Option<String>,
    #[allow(dead_code)]
    id: Option<u64>,
}

/// Send a JSON-RPC request to the daemon via named pipe and return the response.
fn send_rpc(method: &str, params: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let request = RpcRequest {
        method: method.to_string(),
        params,
        id: Some(1),
    };

    let request_json = serde_json::to_string(&request).map_err(|e| e.to_string())?;

    #[cfg(windows)]
    {
        use std::fs::OpenOptions;

        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(r"\\.\pipe\ReefVPN")
            .map_err(|e| format!("cannot connect to daemon: {} (is reefvpn-daemon running?)", e))?;

        // Set read timeout
        // Named pipes on Windows don't support set_read_timeout directly,
        // so we rely on the daemon responding quickly.

        writeln!(file, "{}", request_json)
            .map_err(|e| format!("failed to write to daemon: {}", e))?;
        file.flush().map_err(|e| format!("flush failed: {}", e))?;

        let mut reader = BufReader::new(&file);
        let mut response_line = String::new();
        reader
            .read_line(&mut response_line)
            .map_err(|e| format!("failed to read from daemon: {}", e))?;

        let resp: RpcResponse =
            serde_json::from_str(&response_line).map_err(|e| format!("invalid response: {}", e))?;

        if let Some(err) = resp.error {
            return Err(err);
        }

        resp.result.ok_or_else(|| "empty response".to_string())
    }

    #[cfg(not(windows))]
    {
        use std::net::TcpStream;

        let mut stream = TcpStream::connect_timeout(
            &"127.0.0.1:19876".parse().unwrap(),
            Duration::from_secs(3),
        )
        .map_err(|e| format!("cannot connect to daemon: {} (is reefvpn-daemon running?)", e))?;

        stream
            .set_read_timeout(Some(Duration::from_secs(15)))
            .ok();

        writeln!(stream, "{}", request_json)
            .map_err(|e| format!("failed to write to daemon: {}", e))?;
        stream.flush().map_err(|e| format!("flush failed: {}", e))?;

        let mut reader = BufReader::new(&stream);
        let mut response_line = String::new();
        reader
            .read_line(&mut response_line)
            .map_err(|e| format!("failed to read from daemon: {}", e))?;

        let resp: RpcResponse =
            serde_json::from_str(&response_line).map_err(|e| format!("invalid response: {}", e))?;

        if let Some(err) = resp.error {
            return Err(err);
        }

        resp.result.ok_or_else(|| "empty response".to_string())
    }
}

/// Connect to a VPN server via the daemon.
pub fn connect(params: &ConnectParams) -> Result<String, String> {
    let params_value = serde_json::to_value(params).map_err(|e| e.to_string())?;
    let result = send_rpc("connect", Some(params_value))?;
    Ok(result
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("connected")
        .to_string())
}

/// Disconnect from VPN via the daemon.
pub fn disconnect() -> Result<String, String> {
    let result = send_rpc("disconnect", None)?;
    Ok(result
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("disconnected")
        .to_string())
}

/// Get VPN status from the daemon.
pub fn status() -> Result<StatusResponse, String> {
    let result = send_rpc("status", None)?;
    serde_json::from_value(result).map_err(|e| format!("invalid status: {}", e))
}
