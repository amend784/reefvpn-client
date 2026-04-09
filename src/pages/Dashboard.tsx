import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { api } from '../lib/api';
import { useAppStore } from '../lib/store';
import type { ConnectionMode } from '../lib/store';

// ─── WireGuard config parser ─────────────────────────────────────────────────

function parseWireGuardConfig(config: string, node: any) {
  const iface: Record<string, string> = {};
  const peer: Record<string, string> = {};
  let section = '';

  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).toLowerCase();
      continue;
    }
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (section === 'interface') iface[key] = value;
    if (section === 'peer') peer[key] = value;
  }

  const endpoint = peer.endpoint || `${node.host}:${node.wg_port || 51820}`;
  const lastColon = endpoint.lastIndexOf(':');
  const host = lastColon >= 0 ? endpoint.slice(0, lastColon) : node.host;
  const port = lastColon >= 0 ? Number(endpoint.slice(lastColon + 1)) : Number(node.wg_port || 51820);

  if (!iface.privatekey || !iface.address || !peer.publickey || !host || Number.isNaN(port)) {
    return null;
  }

  return {
    server: {
      id: node.id, name: node.name, host, port,
      country: node.country, city: node.city || '',
      xray_uuid: '', xray_public_key: '', xray_short_id: '',
      wg_public_key: peer.publickey,
      xray_server_name: node.xray_server_name || '',
      xray_grpc_service_name: node.xray_grpc_service_name || '',
      xray_xhttp_path: node.xray_xhttp_path || '',
    },
    protocol: 'wireguard',
    transport: 'wireguard',
    stealth_mode: 'wireguard',
    wireguard_private_key: iface.privatekey,
    wireguard_local_address: iface.address,
    wireguard_dns: iface.dns || node.wg_dns || '1.1.1.1',
    wireguard_allowed_ips: (peer.allowedips || '0.0.0.0/0')
      .split(',').map((item) => item.trim()).filter(Boolean),
  };
}

// ─── Mode definitions ────────────────────────────────────────────────────────

const MODES: { id: ConnectionMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'fast', label: 'Fast' },
  { id: 'stable', label: 'Stable' },
  { id: 'antiblock', label: 'Antiblock' },
];

// Map modes to internal connection strategies
// auto: try wireguard -> reality -> grpc
// fast: wireguard only
// stable: wireguard -> reality fallback
// antiblock: reality (VLESS Reality stealth)
function getModeStrategies(mode: ConnectionMode): string[] {
  switch (mode) {
    case 'fast': return ['wireguard'];
    case 'stable': return ['wireguard', 'reality'];
    case 'antiblock': return ['reality'];
    case 'auto':
    default: return ['wireguard', 'reality', 'grpc'];
  }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const {
    connected, setConnected,
    currentServer, setCurrentServer,
    connectedAt, currentIp, setCurrentIp,
    isLoggedIn, settings, mode, setMode,
  } = useAppStore();

  const { cachedNodes, setCachedNodes } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [nodes, setNodes] = useState<any[]>(cachedNodes);
  const navigate = useNavigate();
  const autoConnectAttempted = useRef(false);

  // Check for updates on mount
  useEffect(() => {
    check().then(async (update) => {
      if (update) {
        await update.downloadAndInstall();
        await relaunch();
      }
    }).catch(() => {});
  }, []);

  // Fetch real IP when connected
  useEffect(() => {
    if (connected && currentIp === '...') {
      fetch('https://api.ipify.org?format=json')
        .then(r => r.json())
        .then(d => setCurrentIp(d.ip))
        .catch(() => setCurrentIp('--'));
    }
  }, [connected]);

  // Uptime timer
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!connectedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - connectedAt) / 1000));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [connectedAt]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const timer = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  // Load nodes + auto-connect
  useEffect(() => {
    const tryAutoConnect = (nodeList: any[]) => {
      if (settings.autoConnect && isLoggedIn && !connected && !autoConnectAttempted.current && nodeList.length > 0) {
        autoConnectAttempted.current = true;
        const lastServerName = localStorage.getItem('vpn_last_server');
        const targetNode = lastServerName
          ? nodeList.find((n: any) => n.name === lastServerName) ?? nodeList[0]
          : nodeList[0];
        connectToServer(targetNode);
      }
    };

    if (cachedNodes.length > 0) tryAutoConnect(cachedNodes);

    api.listNodes().then((freshNodes) => {
      setNodes(freshNodes);
      setCachedNodes(freshNodes);
      if (cachedNodes.length === 0) tryAutoConnect(freshNodes);
    }).catch(() => {});

    invoke<any>('vpn_status').then((status) => {
      if (status?.connected) {
        setConnected(true);
        if (status.server_name) setCurrentServer(status.server_name);
      }
    }).catch(() => {});
  }, []);

  // ── Connect logic ──────────────────────────────────────────────────────────

  async function connectToServer(node: any) {
    if (!node) return;
    setLoading(true);
    const deviceId = localStorage.getItem('vpn_device_id') || crypto.randomUUID();
    localStorage.setItem('vpn_device_id', deviceId);

    // Subscription check
    let vpnUuid = '';
    try {
      const sub = await api.getSubscription();
      const subData = (sub as any)?.subscription || sub;
      if (!subData || subData.status !== 'active' || new Date(subData.expires_at) < new Date()) {
        setStatusMsg('No active subscription');
        setLoading(false);
        return;
      }
      const me = await api.getMe();
      vpnUuid = me?.vpn_uuid || '';
      if (!vpnUuid) {
        setStatusMsg('VPN UUID not assigned');
        setLoading(false);
        return;
      }

      // Device registration
      try {
        const devices = await api.listDevices();
        const thisDevice = devices?.find((d: any) => d.name === deviceId);
        if (!thisDevice) {
          await api.registerDevice(deviceId, 'desktop');
        }
      } catch (devErr: any) {
        if (devErr?.message?.includes('maximum')) {
          setStatusMsg('Device limit reached (max 5)');
          setLoading(false);
          return;
        }
      }
    } catch {
      setStatusMsg('No active subscription');
      setLoading(false);
      return;
    }

    const { settings: s, selectedPreset, mode: currentMode } = useAppStore.getState();

    // Load preset rules
    let presetRules: any[] | undefined = undefined;
    if (selectedPreset) {
      try {
        const cached = localStorage.getItem('vpn_preset_rules');
        let presets = cached ? JSON.parse(cached) : null;
        if (!presets) {
          presets = await api.listBuiltinPresets();
          localStorage.setItem('vpn_preset_rules', JSON.stringify(presets));
        }
        const preset = presets.find((p: any) => p.id === selectedPreset);
        if (preset?.rules) {
          presetRules = preset.rules.map((r: any) => ({
            rule_type: r.type || r.rule_type,
            value: r.value,
            action: r.action,
          }));
        }
      } catch {}
    }

    // Connection strategies based on mode
    const strategies = getModeStrategies(currentMode);

    const STATUS_MESSAGES: Record<string, string> = {
      wireguard: 'Connecting...',
      reality: 'Switching to stealth...',
      grpc: 'Trying backup...',
    };

    let lastError = '';

    for (const strategy of strategies) {
      try {
        setStatusMsg(STATUS_MESSAGES[strategy] || 'Connecting...');

        let params: any;
        if (strategy === 'wireguard') {
          const generated = await api.generateConfig({
            country: node.country,
            city: node.city || '',
            protocol: 'wireguard',
            device_name: deviceId,
            device_type: 'desktop',
          });
          params = parseWireGuardConfig(generated.config, node);
          if (!params) throw new Error('Failed to parse WireGuard config');
        } else {
          const transport = strategy === 'grpc' ? 'grpc' : 'raw';
          params = {
            server: {
              id: node.id, name: node.name, host: node.host,
              port: transport === 'grpc' ? (node.xray_grpc_port || 7443) : (node.port || 443),
              country: node.country, city: node.city || '',
              xray_uuid: vpnUuid,
              xray_public_key: node.xray_public_key || '',
              xray_short_id: node.xray_short_id || '',
              wg_public_key: node.wg_public_key || '',
              xray_server_name: node.xray_server_name || '',
              xray_grpc_service_name: node.xray_grpc_service_name || '',
              xray_xhttp_path: node.xray_xhttp_path || '/vpnxhttp',
            },
            protocol: 'vless',
            transport,
            stealth_mode: transport,
            preset_rules: presetRules,
            kill_switch: s.killSwitch,
            custom_dns: s.dns,
            dns_policy: s.dnsPolicy || 'standard',
          };
        }

        // Include mode in params for the daemon
        params.mode = currentMode;

        await invoke('vpn_connect', { params });
        setConnected(true);
        setCurrentServer(node.name);
        setStatusMsg('');
        setLoading(false);
        return;
      } catch (err: any) {
        console.warn(`${strategy} failed:`, err);
        lastError = err?.message || String(err);
      }
    }

    setStatusMsg(lastError || 'Connection failed');
    setLoading(false);
  }

  async function handleConnect() {
    if (nodes.length === 0) {
      setStatusMsg('No servers available');
      return;
    }
    // Use selected server or first available
    const lastServerName = localStorage.getItem('vpn_last_server');
    const targetNode = lastServerName
      ? nodes.find((n: any) => n.name === lastServerName) ?? nodes[0]
      : nodes[0];
    await connectToServer(targetNode);
  }

  async function handleDisconnect() {
    try {
      await invoke('vpn_disconnect');
      setConnected(false);
      setCurrentServer(null);
      setStatusMsg('');
    } catch (e: any) {
      console.error('Disconnect error:', e);
    }
  }

  // Derive display values
  const countryCode = (currentServer || 'NL').slice(0, 2).toUpperCase();
  const locationName = currentServer || 'Select location';

  return (
    <div className="page-content" style={{ paddingTop: 40 }}>

      {/* Hero */}
      <div className="hero">
        {connected && <div className="hero-glow" />}

        <div className={`hero-status${connected ? '' : ' off'}`}>
          {loading && statusMsg ? statusMsg : (connected ? 'Protected' : 'Not connected')}
        </div>

        <div className={`hero-server${connected ? '' : ' off'}`}>
          {connected ? locationName : 'Unprotected'}
        </div>

        {connected ? (
          <div className="hero-meta">
            <span>{timer}</span>
            <span className="hero-meta-dot" />
            <span>{currentIp}</span>
          </div>
        ) : (
          <div className="hero-meta">
            <span>Your traffic is exposed</span>
          </div>
        )}
      </div>

      {/* Mode buttons */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr 1fr',
        gap: 6,
        marginBottom: 12,
      }}>
        {MODES.map((m) => {
          const isSelected = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 600,
                border: `1px solid ${isSelected ? '#14b8a6' : '#334155'}`,
                borderRadius: 8,
                background: isSelected ? 'rgba(20,184,166,0.15)' : '#1e293b',
                color: isSelected ? '#14b8a6' : '#94a3b8',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Location card */}
      <button className="loc-card" onClick={() => navigate('/locations')}>
        <div className="loc-icon">{countryCode}</div>
        <div className="loc-body">
          <div className="loc-name">{locationName}</div>
          <div className="loc-sub">
            {connected ? `${locationName}` : 'Choose location'}
          </div>
        </div>
        <span className="loc-arrow">&#8250;</span>
      </button>

      {/* Connect / Disconnect */}
      {connected ? (
        <button className="btn-disconnect" onClick={handleDisconnect}>
          Disconnect
        </button>
      ) : (
        <button
          className="btn-connect"
          onClick={handleConnect}
          disabled={loading || nodes.length === 0}
        >
          {loading ? (statusMsg || 'Connecting...') : 'Connect'}
        </button>
      )}
    </div>
  );
}
