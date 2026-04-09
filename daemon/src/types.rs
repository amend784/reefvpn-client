use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub country: String,
    pub city: String,
    pub xray_uuid: String,
    pub xray_public_key: String,
    pub xray_short_id: String,
    pub wg_public_key: String,
    pub xray_server_name: Option<String>,
    pub xray_grpc_service_name: Option<String>,
    pub xray_xhttp_path: Option<String>,
    pub ss_password: Option<String>,
    pub ss_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectRequest {
    pub server: ServerInfo,
    pub mode: Option<String>,           // "auto", "fast", "stable", "antiblock"
    pub protocol: String,              // resolved: "vless", "wireguard", "shadowsocks"
    pub transport: String,             // resolved: "raw", "grpc", "xhttp"
    pub stealth_mode: Option<String>,  // legacy compat
    pub preset_rules: Option<Vec<RouteRule>>,
    pub wireguard_private_key: Option<String>,
    pub wireguard_local_address: Option<String>,
    pub wireguard_dns: Option<String>,
    pub wireguard_allowed_ips: Option<Vec<String>>,
    // Settings
    pub kill_switch: Option<bool>,
    pub custom_dns: Option<String>,
    pub dns_policy: Option<String>,
    pub local_network: Option<bool>,
    pub mtu: Option<u16>,
    pub ipv6: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteRule {
    pub rule_type: String,
    pub value: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusResponse {
    pub state: ConnectionState,
    pub server: Option<String>,
    pub protocol: Option<String>,
    pub ip: Option<String>,
    pub uptime_secs: Option<u64>,
}

// JSON-RPC types
#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub method: String,
    pub params: Option<serde_json::Value>,
    pub id: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub id: Option<u64>,
}
