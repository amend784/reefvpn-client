use crate::types::ConnectRequest;
use log::info;
use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

const DEFAULT_DNS_IP: &str = "1.1.1.1";

pub struct SingBoxManager {
    process: Mutex<Option<Child>>,
    config_path: PathBuf,
    binary_path: PathBuf,
}

impl SingBoxManager {
    pub fn new() -> Self {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ReefVPN");
        fs::create_dir_all(&data_dir).ok();

        Self {
            process: Mutex::new(None),
            config_path: data_dir.join("sing-box-config.json"),
            binary_path: Self::find_binary(),
        }
    }

    fn find_binary() -> PathBuf {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));

        let candidates = [
            exe_dir.join("sing-box.exe"),
            exe_dir.join("resources").join("sing-box.exe"),
            exe_dir.join("_up_").join("resources").join("sing-box.exe"),
            PathBuf::from(r"C:\Program Files\ReefVPN\sing-box.exe"),
            PathBuf::from(r"C:\Program Files\ReefVPN\resources\sing-box.exe"),
            PathBuf::from(r"C:\Program Files\ReefVPN\_up_\resources\sing-box.exe"),
        ];

        for c in &candidates {
            if c.exists() {
                return c.clone();
            }
        }

        exe_dir.join("sing-box.exe")
    }

    pub fn generate_config(&self, req: &ConnectRequest) -> Result<String, String> {
        let outbound = match req.protocol.as_str() {
            "wireguard" => self.build_wireguard_outbound(req)?,
            "shadowsocks" => self.build_shadowsocks_outbound(req)?,
            _ => {
                // VLESS with stealth mode selection
                let stealth = req.stealth_mode.as_deref().unwrap_or("auto");
                let mut request = req.clone();
                match stealth {
                    "auto" | "wireguard" | "reality" | "raw" | "tcp" | "" => {
                        request.transport = "raw".to_string();
                        if request.server.port == 0 {
                            request.server.port = 443;
                        }
                    }
                    "grpc" => {
                        request.transport = "grpc".to_string();
                    }
                    "xhttp" => {
                        request.transport = "xhttp".to_string();
                    }
                    _ => {
                        request.transport = req.transport.clone();
                    }
                }
                self.build_vless_outbound(&request)?
            }
        };

        let route_rules = self.build_route_rules(req);

        // ── DNS resolution ────────────────────────────────────────────────────
        let policy = req.dns_policy.as_deref().unwrap_or("standard");
        let proxy_dns_addr = match policy {
            "block_ads" => "https://94.140.14.14/dns-query".to_string(),
            "block_ads_trackers" => "https://94.140.14.15/dns-query".to_string(),
            _ => format!("https://{}/dns-query", req.custom_dns.as_deref().unwrap_or(DEFAULT_DNS_IP)),
        };
        let dns_strategy = if req.ipv6.unwrap_or(false) { "prefer_ipv4" } else { "ipv4_only" };

        // ── TUN inbound ───────────────────────────────────────────────────────
        let strict_route = req.kill_switch.unwrap_or(true);
        let mut tun_addresses = vec!["172.19.0.1/30"];
        let ipv6_addr;
        if req.ipv6.unwrap_or(false) {
            ipv6_addr = "fdfe:dcba:9876::1/126".to_string();
            tun_addresses.push(&ipv6_addr);
        }
        let mut tun_inbound = serde_json::json!({
            "type": "tun",
            "tag": "tun-in",
            "interface_name": "ReefVPN",
            "address": tun_addresses,
            "auto_route": true,
            "strict_route": strict_route,
            "stack": "system"
        });
        if let Some(mtu_val) = req.mtu {
            if mtu_val > 0 {
                tun_inbound["mtu"] = serde_json::json!(mtu_val);
            }
        }

        let dns_server_ip = proxy_dns_addr
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or(DEFAULT_DNS_IP);

        let config = serde_json::json!({
            "log": {
                "level": "warn",
                "timestamp": true
            },
            "dns": {
                "servers": [
                    {
                        "type": "https",
                        "tag": "proxy-dns",
                        "server": dns_server_ip,
                        "detour": "proxy"
                    },
                    {
                        "type": "udp",
                        "tag": "direct-dns",
                        "server": dns_server_ip
                    }
                ],
                "strategy": dns_strategy
            },
            "inbounds": [tun_inbound],
            "outbounds": [
                outbound,
                {
                    "type": "direct",
                    "tag": "direct"
                },
                {
                    "type": "block",
                    "tag": "block"
                }
            ],
            "route": {
                "rules": route_rules,
                "auto_detect_interface": true,
                "default_domain_resolver": "direct-dns",
                "final": "proxy"
            }
        });

        serde_json::to_string_pretty(&config).map_err(|e| e.to_string())
    }

    fn build_vless_outbound(&self, req: &ConnectRequest) -> Result<serde_json::Value, String> {
        let server_name = req
            .server
            .xray_server_name
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "xray_server_name is required for Reality connections".to_string())?;

        let mut outbound = serde_json::json!({
            "type": "vless",
            "tag": "proxy",
            "server": req.server.host,
            "server_port": req.server.port,
            "uuid": req.server.xray_uuid,
            "tls": {
                "enabled": true,
                "server_name": server_name,
                "utls": {
                    "enabled": true,
                    "fingerprint": "chrome"
                },
                "reality": {
                    "enabled": true,
                    "public_key": req.server.xray_public_key,
                    "short_id": req.server.xray_short_id
                }
            }
        });

        match req.transport.as_str() {
            "raw" | "reality" | "tcp" | "" => {
                outbound["flow"] = serde_json::json!("xtls-rprx-vision");
            }
            "grpc" => {
                outbound["transport"] = serde_json::json!({
                    "type": "grpc",
                    "service_name": req.server.xray_grpc_service_name.clone().unwrap_or_else(|| "vpngrpc".to_string())
                });
            }
            "xhttp" => {
                let xhttp_path = req.server.xray_xhttp_path.clone().unwrap_or_else(|| "/vpnxhttp".to_string());
                outbound["transport"] = serde_json::json!({
                    "type": "httpupgrade",
                    "host": req.server.xray_server_name.clone().unwrap_or_default(),
                    "path": xhttp_path
                });
            }
            other => {
                return Err(format!("unsupported vless transport: {}", other));
            }
        }

        Ok(outbound)
    }

    fn build_wireguard_outbound(&self, req: &ConnectRequest) -> Result<serde_json::Value, String> {
        let local_address = req
            .wireguard_local_address
            .clone()
            .ok_or_else(|| "wireguard local address is required".to_string())?;
        let private_key = req
            .wireguard_private_key
            .clone()
            .ok_or_else(|| "wireguard private key is required".to_string())?;

        Ok(serde_json::json!({
            "type": "wireguard",
            "tag": "proxy",
            "server": req.server.host,
            "server_port": req.server.port,
            "local_address": [local_address],
            "private_key": private_key,
            "peer_public_key": req.server.wg_public_key,
            "workers": 2
        }))
    }

    fn build_shadowsocks_outbound(&self, req: &ConnectRequest) -> Result<serde_json::Value, String> {
        let password = req.server.ss_password.clone()
            .filter(|p| !p.trim().is_empty())
            .ok_or_else(|| "shadowsocks password is required".to_string())?;
        let port = req.server.ss_port.unwrap_or(8388);

        Ok(serde_json::json!({
            "type": "shadowsocks",
            "tag": "proxy",
            "server": req.server.host,
            "server_port": port,
            "method": "2022-blake3-aes-128-gcm",
            "password": password
        }))
    }

    fn build_route_rules(&self, req: &ConnectRequest) -> Vec<serde_json::Value> {
        let mut rules = vec![
            serde_json::json!({
                "action": "sniff",
                "timeout": "300ms"
            }),
            serde_json::json!({
                "protocol": "dns",
                "action": "hijack-dns"
            }),
        ];

        if req.local_network.unwrap_or(false) {
            rules.push(serde_json::json!({
                "ip_cidr": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
                "action": "route",
                "outbound": "direct"
            }));
        }

        if let Some(preset) = req.preset_rules.as_deref() {
            for rule in preset {
                let outbound = match rule.action.as_str() {
                    "proxy" => "proxy",
                    "direct" => "direct",
                    "block" => "block",
                    _ => "proxy",
                };

                let sing_rule = match rule.rule_type.as_str() {
                    "domain" => serde_json::json!({
                        "domain": [rule.value],
                        "action": "route",
                        "outbound": outbound
                    }),
                    "domain_suffix" => serde_json::json!({
                        "domain_suffix": [rule.value],
                        "action": "route",
                        "outbound": outbound
                    }),
                    "domain_keyword" => serde_json::json!({
                        "domain_keyword": [rule.value],
                        "action": "route",
                        "outbound": outbound
                    }),
                    "geoip" => serde_json::json!({
                        "geoip": [rule.value.to_lowercase()],
                        "action": "route",
                        "outbound": outbound
                    }),
                    "ip_cidr" => serde_json::json!({
                        "ip_cidr": [rule.value],
                        "action": "route",
                        "outbound": outbound
                    }),
                    "process" => serde_json::json!({
                        "process_name": [rule.value],
                        "action": "route",
                        "outbound": outbound
                    }),
                    _ => continue,
                };

                rules.push(sing_rule);
            }
        }

        rules
    }

    pub fn start(&self, req: &ConnectRequest) -> Result<(), String> {
        self.stop().ok();

        if !self.binary_path.exists() {
            return Err(format!(
                "sing-box not found at: {}",
                self.binary_path.display()
            ));
        }

        let config = self.generate_config(req)?;
        fs::write(&self.config_path, &config)
            .map_err(|e| format!("failed to write config: {}", e))?;

        info!("Starting sing-box with config: {}", self.config_path.display());

        #[cfg(windows)]
        use std::os::windows::process::CommandExt;

        let mut cmd = Command::new(&self.binary_path);
        cmd.arg("run").arg("-c").arg(&self.config_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let child = cmd.spawn()
            .map_err(|e| format!("failed to start sing-box: {}", e))?;

        info!("sing-box started with PID: {}", child.id());
        *self.process.lock().unwrap() = Some(child);

        // Wait for TUN interface to come up
        std::thread::sleep(Duration::from_secs(2));

        // Verify connectivity
        let check_addr = format!("{}:{}", req.server.host, req.server.port)
            .to_socket_addrs()
            .map_err(|e| format!("failed to resolve server address: {}", e))?
            .next()
            .ok_or_else(|| "failed to resolve server address".to_string())?;
        for attempt in 1..=2 {
            match TcpStream::connect_timeout(&check_addr, Duration::from_secs(5)) {
                Ok(_) => {
                    info!("Connectivity check passed on attempt {}", attempt);
                    return Ok(());
                }
                Err(e) => {
                    if attempt < 2 {
                        std::thread::sleep(Duration::from_secs(1));
                    } else {
                        let proc_alive = self.is_running();
                        self.stop().ok();
                        return Err(format!(
                            "connectivity check failed (process {}): {}",
                            if proc_alive { "alive" } else { "dead" },
                            e
                        ));
                    }
                }
            }
        }

        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        if let Some(mut child) = self.process.lock().unwrap().take() {
            info!("Stopping sing-box PID: {}", child.id());
            child.kill().ok();
            child.wait().ok();
        }

        fs::remove_file(&self.config_path).ok();
        Ok(())
    }

    pub fn is_running(&self) -> bool {
        if let Some(ref mut child) = *self.process.lock().unwrap() {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }
}

impl Drop for SingBoxManager {
    fn drop(&mut self) {
        self.stop().ok();
    }
}
