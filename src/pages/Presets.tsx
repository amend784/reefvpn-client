import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAppStore } from '../lib/store';

// ─── icons ────────────────────────────────────────────────────────────────────

function IconBack() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M9 3L5 7l4 4"/>
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M7 2v10M2 7h10"/>
    </svg>
  );
}

// ─── preset descriptions ──────────────────────────────────────────────────────

const PRESET_DESCRIPTIONS: Record<string, string> = {
  'Full tunnel': 'Route all traffic through VPN',
  'Split tunnel': 'Only route selected apps',
  'Direct': 'No routing — direct connection',
  'Bypass LAN': 'Keep local network direct',
};

function presetDescription(name: string) {
  return PRESET_DESCRIPTIONS[name] || 'Custom routing configuration';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Presets() {
  const navigate = useNavigate();
  const { selectedPreset, setSelectedPreset } = useAppStore();
  const [builtins, setBuiltins] = useState<any[]>([]);
  const [userPresets, setUserPresets] = useState<any[]>([]);

  useEffect(() => {
    api.listBuiltinPresets().then((presets) => {
      setBuiltins(presets);
      if (!selectedPreset && presets.length > 0) {
        setSelectedPreset(presets[0].id);
      }
    }).catch(() => {
      const fallback = [
        { id: 'full', name: 'Full tunnel', mode: 'all', default_action: 'proxy' },
        { id: 'split', name: 'Split tunnel', mode: 'split', default_action: 'direct' },
        { id: 'direct', name: 'Direct', mode: 'direct', default_action: 'direct' },
        { id: 'bypass', name: 'Bypass LAN', mode: 'lan', default_action: 'proxy' },
      ];
      setBuiltins(fallback);
      if (!selectedPreset) setSelectedPreset(fallback[0].id);
    });
    api.listUserPresets().then(setUserPresets).catch(() => {});
  }, []);

  return (
    <div className="page-content" style={{ paddingTop: 0 }}>
      {/* Back header */}
      <div className="back-header" style={{ paddingTop: 40 }}>
        <button className="back-btn" onClick={() => navigate('/settings')}>
          <IconBack />
        </button>
        <span className="page-title">Split Tunneling</span>
      </div>

      {/* Presets */}
      <div className="section-label">Presets</div>

      <div>
        {builtins.map((p) => {
          const isSelected = selectedPreset === p.id;
          return (
            <div
              key={p.id}
              className="preset-item"
              onClick={() => setSelectedPreset(p.id)}
            >
              <div className="preset-item-body">
                <div className="preset-item-name">{p.name}</div>
                <div className="preset-item-desc">{presetDescription(p.name)}</div>
              </div>
              <div className={`radio-circle ${isSelected ? 'active' : ''}`}>
                {isSelected && <div className="radio-dot" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />

      {/* Custom */}
      <div className="section-label" style={{ marginTop: 8 }}>Custom</div>

      {userPresets.length > 0 && (
        <div>
          {userPresets.map((p) => {
            const isSelected = selectedPreset === p.id;
            return (
              <div
                key={p.id}
                className="preset-item"
                onClick={() => setSelectedPreset(p.id)}
              >
                <div className="preset-item-body">
                  <div className="preset-item-name">{p.name}</div>
                  <div className="preset-item-desc">{p.mode}</div>
                </div>
                <div className={`radio-circle ${isSelected ? 'active' : ''}`}>
                  {isSelected && <div className="radio-dot" />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button className="create-preset-btn">
        <IconPlus />
        Create preset
      </button>
    </div>
  );
}
