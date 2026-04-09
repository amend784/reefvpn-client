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
pub struct ConnectParams {
    pub server: ServerInfo,
    pub mode: Option<String>,    // "auto", "fast", "stable", "antiblock"
    pub protocol: String,        // resolved: "vless", "wireguard", "shadowsocks"
    pub transport: String,       // resolved: "raw", "grpc", "xhttp"
    pub stealth_mode: Option<String>,  // legacy
    pub preset_rules: Option<Vec<RouteRule>>,
    // WireGuard specific
    pub wireguard_private_key: Option<String>,
    pub wireguard_local_address: Option<String>,
    pub wireguard_dns: Option<String>,
    pub wireguard_allowed_ips: Option<Vec<String>>,
    // Settings wired from UI
    pub kill_switch: Option<bool>,        // strict_route on/off
    pub custom_dns: Option<String>,       // "1.1.1.1", "8.8.8.8", etc.
    pub dns_policy: Option<String>,       // "standard", "block_ads", "block_ads_trackers"
    pub local_network: Option<bool>,      // exclude LAN CIDRs from TUN
    pub mtu: Option<u16>,                 // TUN MTU; 0 or None = auto
    pub ipv6: Option<bool>,              // add IPv6 address to TUN inbound
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteRule {
    pub rule_type: String, // "domain", "domain_suffix", "geoip", "ip_cidr", "process"
    pub value: String,
    pub action: String, // "proxy", "direct", "block"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusResponse {
    pub state: ConnectionState,
    pub server: Option<String>,
    pub protocol: Option<String>,
    pub ip: Option<String>,
    pub uptime_secs: Option<u64>,
}
