import { create } from 'zustand';

// ─── Settings ─────────────────────────────────────────────────────────────────

export type ConnectionMode = 'auto' | 'fast' | 'stable' | 'antiblock';

export interface AppSettings {
  killSwitch: boolean;
  autoConnect: boolean;
  dns: string;
  dnsPolicy: 'standard' | 'block_ads' | 'block_ads_trackers';
  selectedPreset: string;
}

const SETTINGS_KEY = 'vpn_settings';

const defaultSettings: AppSettings = {
  killSwitch: true,
  autoConnect: false,
  dns: '1.1.1.1',
  dnsPolicy: 'standard',
  selectedPreset: 'full',
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {}
  return { ...defaultSettings };
}

function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

// ─── Store ─────────────────────────────────────────────────────────────────────

interface AppState {
  // Auth
  isLoggedIn: boolean;
  accountNumber: string | null;
  setLoggedIn: (v: boolean) => void;
  setAccountNumber: (v: string | null) => void;

  // Connection
  connected: boolean;
  currentServer: string | null;
  connectedAt: number | null;
  currentIp: string;
  subscription: any | null;
  setConnected: (v: boolean) => void;
  setCurrentServer: (s: string | null) => void;
  setConnectedAt: (t: number | null) => void;
  setCurrentIp: (ip: string) => void;
  setSubscription: (s: any) => void;

  // Connection mode
  mode: ConnectionMode;
  setMode: (m: ConnectionMode) => void;

  // Presets
  selectedPreset: string | null;
  setSelectedPreset: (id: string | null) => void;

  // Cached nodes
  cachedNodes: any[];
  setCachedNodes: (nodes: any[]) => void;

  // Settings
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Auth
  isLoggedIn: !!localStorage.getItem('vpn_token'),
  accountNumber: localStorage.getItem('vpn_account'),
  setLoggedIn: (v) => set({ isLoggedIn: v }),
  setAccountNumber: (v) => {
    set({ accountNumber: v });
    if (v) localStorage.setItem('vpn_account', v);
  },

  // Connection
  connected: false,
  currentServer: null,
  connectedAt: null,
  currentIp: '...',
  setConnected: (v) => set({ connected: v, connectedAt: v ? Date.now() : null, currentIp: v ? '...' : '...' }),
  subscription: null,
  setConnectedAt: (t) => set({ connectedAt: t }),
  setCurrentIp: (ip) => set({ currentIp: ip }),
  setSubscription: (s) => set({ subscription: s }),
  setCurrentServer: (s) => {
    set({ currentServer: s });
    if (s) localStorage.setItem('vpn_last_server', s);
  },

  // Connection mode (persisted)
  mode: (localStorage.getItem('vpn_mode') as ConnectionMode) || 'auto',
  setMode: (m) => {
    localStorage.setItem('vpn_mode', m);
    set({ mode: m });
  },

  // Presets (persisted)
  selectedPreset: localStorage.getItem('vpn_selected_preset') || 'full',
  setSelectedPreset: (id) => {
    if (id) localStorage.setItem('vpn_selected_preset', id);
    else localStorage.removeItem('vpn_selected_preset');
    set({ selectedPreset: id });
  },

  // Cached nodes
  cachedNodes: JSON.parse(localStorage.getItem('vpn_cached_nodes') || '[]'),
  setCachedNodes: (nodes: any[]) => {
    localStorage.setItem('vpn_cached_nodes', JSON.stringify(nodes));
    set({ cachedNodes: nodes });
  },

  // Settings
  settings: loadSettings(),
  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    saveSettings(next);
    set({ settings: next });
  },
}));
