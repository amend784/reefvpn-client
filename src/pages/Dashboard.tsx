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
    if (line.startsWith('[') && line.endsWith(']')) { section = line.slice(1, -1).toLowerCase(); continue; }
    const sep = line.indexOf('=');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (section === 'interface') iface[key] = value;
    if (section === 'peer') peer[key] = value;
  }
  const endpoint = peer.endpoint || `${node.host}:${node.wg_port || 51820}`;
  const lastColon = endpoint.lastIndexOf(':');
  const host = lastColon >= 0 ? endpoint.slice(0, lastColon) : node.host;
  const port = lastColon >= 0 ? Number(endpoint.slice(lastColon + 1)) : Number(node.wg_port || 51820);
  if (!iface.privatekey || !iface.address || !peer.publickey || !host || Number.isNaN(port)) return null;
  return {
    server: {
      id: node.id, name: node.name, host, port, country: node.country, city: node.city || '',
      xray_uuid: '', xray_public_key: '', xray_short_id: '', wg_public_key: peer.publickey,
      xray_server_name: node.xray_server_name || '', xray_grpc_service_name: node.xray_grpc_service_name || '',
      xray_xhttp_path: node.xray_xhttp_path || '',
    },
    protocol: 'wireguard', transport: 'wireguard', stealth_mode: 'wireguard',
    wireguard_private_key: iface.privatekey, wireguard_local_address: iface.address,
    wireguard_dns: iface.dns || node.wg_dns || '1.1.1.1',
    wireguard_allowed_ips: (peer.allowedips || '0.0.0.0/0').split(',').map(s => s.trim()).filter(Boolean),
  };
}

const MODE_LABELS: Record<ConnectionMode, string> = { auto: 'Auto', fast: 'Fast', stable: 'Stable', antiblock: 'Antiblock' };

function getModeStrategies(mode: ConnectionMode): string[] {
  switch (mode) {
    case 'fast': return ['wireguard'];
    case 'stable': return ['wireguard', 'reality'];
    case 'antiblock': return ['reality'];
    default: return ['wireguard', 'reality', 'grpc'];
  }
}

// ─── Country coords for map dot ─────────────────────────────────────────────
const COUNTRY_POS: Record<string, { top: string; left: string }> = {
  NL: { top: '28%', left: '48%' }, DE: { top: '30%', left: '50%' }, US: { top: '35%', left: '22%' },
  GB: { top: '27%', left: '45%' }, FR: { top: '32%', left: '47%' }, JP: { top: '35%', left: '85%' },
  SG: { top: '55%', left: '78%' }, AU: { top: '75%', left: '85%' }, CA: { top: '25%', left: '20%' },
  SE: { top: '22%', left: '52%' }, FI: { top: '20%', left: '55%' }, CH: { top: '32%', left: '49%' },
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { connected, setConnected, currentServer, setCurrentServer, connectedAt, currentIp, setCurrentIp, isLoggedIn, settings, mode, setMode } = useAppStore();
  const { cachedNodes, setCachedNodes } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [nodes, setNodes] = useState<any[]>(cachedNodes);
  const navigate = useNavigate();
  const autoConnectAttempted = useRef(false);

  // Updates
  useEffect(() => { check().then(async (u) => { if (u) { await u.downloadAndInstall(); await relaunch(); } }).catch(() => {}); }, []);

  // IP fetch
  useEffect(() => {
    if (connected && currentIp === '...') {
      fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => setCurrentIp(d.ip)).catch(() => setCurrentIp('--'));
    }
  }, [connected]);

  // Timer
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!connectedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - connectedAt) / 1000));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [connectedAt]);
  const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = elapsed % 60;
  const timer = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  // Load nodes + auto-connect
  useEffect(() => {
    const tryAuto = (list: any[]) => {
      if (settings.autoConnect && isLoggedIn && !connected && !autoConnectAttempted.current && list.length > 0) {
        autoConnectAttempted.current = true;
        const last = localStorage.getItem('vpn_last_server');
        connectToServer(last ? list.find(n => n.name === last) ?? list[0] : list[0]);
      }
    };
    if (cachedNodes.length > 0) tryAuto(cachedNodes);
    api.listNodes().then(fresh => { setNodes(fresh); setCachedNodes(fresh); if (cachedNodes.length === 0) tryAuto(fresh); }).catch(() => {});
    invoke<any>('vpn_status').then(st => { if (st?.connected) { setConnected(true); if (st.server_name) setCurrentServer(st.server_name); } }).catch(() => {});
  }, []);

  // ── Connect ────────────────────────────────────────────────────────────────
  async function connectToServer(node: any) {
    if (!node) return;
    setLoading(true);
    const deviceId = localStorage.getItem('vpn_device_id') || crypto.randomUUID();
    localStorage.setItem('vpn_device_id', deviceId);
    localStorage.setItem('vpn_last_server', node.name);

    let vpnUuid = '';
    try {
      const sub = await api.getSubscription();
      const subData = (sub as any)?.subscription || sub;
      if (!subData || subData.status !== 'active' || new Date(subData.expires_at) < new Date()) {
        setStatusMsg('No active subscription'); setLoading(false); return;
      }
      const me = await api.getMe();
      vpnUuid = me?.vpn_uuid || '';
      if (!vpnUuid) { setStatusMsg('VPN UUID not assigned'); setLoading(false); return; }
      try {
        const devices = await api.listDevices();
        if (!devices?.find((d: any) => d.name === deviceId)) await api.registerDevice(deviceId, 'desktop');
      } catch (e: any) { if (e?.message?.includes('maximum')) { setStatusMsg('Device limit reached'); setLoading(false); return; } }
    } catch { setStatusMsg('No active subscription'); setLoading(false); return; }

    const { settings: s, selectedPreset, mode: currentMode } = useAppStore.getState();
    let presetRules: any[] | undefined;
    if (selectedPreset) {
      try {
        const cached = localStorage.getItem('vpn_preset_rules');
        let presets = cached ? JSON.parse(cached) : null;
        if (!presets) { presets = await api.listBuiltinPresets(); localStorage.setItem('vpn_preset_rules', JSON.stringify(presets)); }
        const preset = presets.find((p: any) => p.id === selectedPreset);
        if (preset?.rules) presetRules = preset.rules.map((r: any) => ({ rule_type: r.type || r.rule_type, value: r.value, action: r.action }));
      } catch {}
    }

    const strategies = getModeStrategies(currentMode);
    const MSG: Record<string, string> = { wireguard: 'Connecting...', reality: 'Switching to stealth...', grpc: 'Trying backup route...' };
    let lastError = '';

    for (const strategy of strategies) {
      try {
        setStatusMsg(MSG[strategy] || 'Connecting...');
        let params: any;
        if (strategy === 'wireguard') {
          const gen = await api.generateConfig({ country: node.country, city: node.city || '', protocol: 'wireguard', device_name: deviceId, device_type: 'desktop' });
          params = parseWireGuardConfig(gen.config, node);
          if (!params) throw new Error('Failed to parse WireGuard config');
        } else {
          const transport = strategy === 'grpc' ? 'grpc' : 'raw';
          params = {
            server: { id: node.id, name: node.name, host: node.host, port: transport === 'grpc' ? (node.xray_grpc_port || 7443) : (node.port || 443), country: node.country, city: node.city || '', xray_uuid: vpnUuid, xray_public_key: node.xray_public_key || '', xray_short_id: node.xray_short_id || '', wg_public_key: node.wg_public_key || '', xray_server_name: node.xray_server_name || '', xray_grpc_service_name: node.xray_grpc_service_name || '', xray_xhttp_path: node.xray_xhttp_path || '/vpnxhttp' },
            protocol: 'vless', transport, stealth_mode: transport,
            preset_rules: presetRules, kill_switch: s.killSwitch, custom_dns: s.dns, dns_policy: s.dnsPolicy || 'standard',
          };
        }
        params.mode = currentMode;
        await invoke('vpn_connect', { params });
        setConnected(true); setCurrentServer(node.name); setStatusMsg(''); setLoading(false);
        return;
      } catch (err: any) { lastError = err?.message || String(err); }
    }
    setStatusMsg(lastError || 'Connection failed'); setLoading(false);
  }

  async function handleConnect() {
    if (nodes.length === 0) { setStatusMsg('No servers available'); return; }
    const last = localStorage.getItem('vpn_last_server');
    await connectToServer(last ? nodes.find(n => n.name === last) ?? nodes[0] : nodes[0]);
  }

  async function handleDisconnect() {
    try { await invoke('vpn_disconnect'); setConnected(false); setCurrentServer(null); setStatusMsg(''); } catch {}
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedNode = nodes.find(n => n.name === currentServer) || nodes[0];
  const cc = selectedNode?.country || 'NL';
  const city = selectedNode?.city || 'Amsterdam';
  const dotPos = COUNTRY_POS[cc] || { top: '35%', left: '50%' };

  return (
    <div className="page-content" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100vh', paddingTop: 32 }}>

      {/* ── Map area ──────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, position: 'relative', overflow: 'hidden',
        background: connected ? '#1a3a4a' : '#1e293b',
        transition: 'background 0.5s',
        minHeight: 200,
      }}>
        {/* Grid lines */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }} />

        {/* World map outline (simplified SVG) */}
        <svg viewBox="0 0 1000 500" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.08 }}>
          <path d="M150,120 Q200,80 280,100 Q320,110 350,90 Q380,70 420,80 L450,120 Q460,150 440,180 Q420,200 380,210 Q340,220 300,200 Q260,180 220,190 Q180,200 150,180 Z" fill="currentColor"/>
          <path d="M450,70 Q500,50 560,60 Q620,70 680,90 Q740,110 780,80 Q820,60 860,70 L880,100 Q890,130 870,160 Q850,190 810,200 Q770,210 730,190 Q690,170 650,180 Q610,190 570,170 Q530,150 490,160 Q460,140 450,110 Z" fill="currentColor"/>
          <path d="M460,200 Q500,180 540,190 Q580,200 600,230 Q620,260 600,290 Q580,320 540,330 Q500,340 480,310 Q460,280 450,250 Q440,220 460,200 Z" fill="currentColor"/>
          <path d="M100,200 Q140,170 200,180 Q260,190 300,220 Q340,250 320,290 Q300,330 260,350 Q220,370 180,350 Q140,330 120,290 Q100,250 100,200 Z" fill="currentColor"/>
          <path d="M700,300 Q760,270 820,280 Q880,290 920,320 Q950,350 930,380 Q910,410 860,420 Q810,430 760,410 Q720,390 700,350 Q690,320 700,300 Z" fill="currentColor"/>
        </svg>

        {/* Location dot */}
        {connected && (
          <div style={{ position: 'absolute', ...dotPos, transform: 'translate(-50%, -50%)', zIndex: 2 }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%', background: '#14b8a6',
              boxShadow: '0 0 20px rgba(20,184,166,0.6), 0 0 40px rgba(20,184,166,0.3)',
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            <div style={{
              position: 'absolute', top: -28, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.7)', padding: '3px 8px', borderRadius: 4,
              fontSize: 10, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap',
            }}>{cc}</div>
          </div>
        )}
      </div>

      {/* ── Status panel ──────────────────────────────────────────────────── */}
      <div style={{
        background: '#0f172a', borderTop: '1px solid #334155',
        padding: '16px 16px 12px',
      }}>
        {/* Status line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#14b8a6' : '#64748b',
            boxShadow: connected ? '0 0 8px rgba(20,184,166,0.5)' : 'none',
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: connected ? '#14b8a6' : '#64748b' }}>
            {loading ? (statusMsg || 'Connecting...') : connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* Location info */}
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>
          {connected ? `${cc}, ${city}` : 'Not connected'}
        </div>
        {connected && (
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{currentServer}</div>
        )}

        {/* Meta row */}
        {connected && (
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #334155', color: '#94a3b8' }}>
              {MODE_LABELS[mode]}
            </span>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #334155', color: '#94a3b8' }}>
              {timer}
            </span>
            {currentIp && currentIp !== '...' && (
              <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', fontFamily: 'monospace' }}>
                {currentIp}
              </span>
            )}
          </div>
        )}

        {/* Mode selector + location */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {(['auto', 'fast', 'stable', 'antiblock'] as ConnectionMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, border: `1px solid ${mode === m ? '#14b8a6' : '#334155'}`,
              borderRadius: 6, background: mode === m ? 'rgba(20,184,166,0.15)' : 'transparent',
              color: mode === m ? '#14b8a6' : '#64748b', cursor: 'pointer',
            }}>{MODE_LABELS[m]}</button>
          ))}
        </div>

        {/* Location button */}
        <button onClick={() => navigate('/locations')} style={{
          width: '100%', marginTop: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8, cursor: 'pointer', color: '#f1f5f9',
        }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {connected ? `${cc} / ${city}` : 'Change location'}
          </span>
          <span style={{ color: '#64748b', fontSize: 16 }}>&#8635;</span>
        </button>

        {/* Connect / Disconnect */}
        {connected ? (
          <button onClick={handleDisconnect} style={{
            width: '100%', marginTop: 8, padding: 12, border: 'none', borderRadius: 8,
            background: '#ef4444', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>Disconnect</button>
        ) : (
          <button onClick={handleConnect} disabled={loading || nodes.length === 0} style={{
            width: '100%', marginTop: 8, padding: 12, border: 'none', borderRadius: 8,
            background: '#14b8a6', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            opacity: loading ? 0.6 : 1,
          }}>{loading ? (statusMsg || 'Connecting...') : 'Connect'}</button>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.6; } }`}</style>
    </div>
  );
}
