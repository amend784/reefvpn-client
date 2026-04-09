import { useNavigate } from 'react-router-dom';
import { clearAuth } from '../lib/api';
import { useAppStore } from '../lib/store';

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button className={`toggle ${on ? 'active' : ''}`} onClick={onChange}>
      <div className="toggle-thumb" />
    </button>
  );
}

// ─── Settings row ────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      {children}
    </div>
  );
}

// ─── DNS policy labels ───────────────────────────────────────────────────────

const DNS_POLICIES = ['standard', 'block_ads', 'block_ads_trackers'] as const;
const DNS_LABELS: Record<string, string> = {
  standard: 'Standard',
  block_ads: 'Block ads',
  block_ads_trackers: 'Block ads + trackers',
};

// ─── Chevron icon ────────────────────────────────────────────────────────────

function IconChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--dim)" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4.5 2.5L8 6l-3.5 3.5"/>
    </svg>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate();
  const { settings, updateSettings, setLoggedIn } = useAppStore();

  function cycleDnsPolicy() {
    const idx = DNS_POLICIES.indexOf(settings.dnsPolicy);
    const next = DNS_POLICIES[(idx + 1) % DNS_POLICIES.length];
    updateSettings({ dnsPolicy: next });
  }

  function handleLogout() {
    clearAuth();
    setLoggedIn(false);
    navigate('/login');
  }

  return (
    <div className="page-content" style={{ paddingTop: 40 }}>

      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Settings</div>

      {/* Main settings card */}
      <div className="settings-card">
        <Row label="Kill switch">
          <Toggle
            on={settings.killSwitch}
            onChange={() => updateSettings({ killSwitch: !settings.killSwitch })}
          />
        </Row>
        <Row label="Auto-connect">
          <Toggle
            on={settings.autoConnect}
            onChange={() => updateSettings({ autoConnect: !settings.autoConnect })}
          />
        </Row>
        <Row label="DNS policy">
          <button
            className="settings-row-value"
            onClick={cycleDnsPolicy}
            style={{
              background: 'none', cursor: 'pointer', color: 'var(--accent)',
              fontFamily: 'system-ui, sans-serif', fontSize: 12, border: 'none',
              padding: '4px 10px', borderRadius: 6,
            }}
          >
            {DNS_LABELS[settings.dnsPolicy] || 'Standard'}
          </button>
        </Row>
      </div>

      {/* Navigation links */}
      <div className="settings-card" style={{ marginTop: 4 }}>
        <button
          className="settings-row"
          onClick={() => navigate('/settings/apps')}
          style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}
        >
          <span className="settings-row-label">Split tunneling</span>
          <IconChevron />
        </button>
        <button
          className="settings-row"
          onClick={() => navigate('/settings/account')}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <span className="settings-row-label">Account</span>
          <IconChevron />
        </button>
      </div>

      {/* Sign out */}
      <button
        className="btn-danger"
        onClick={handleLogout}
        style={{ width: '100%', marginTop: 16 }}
      >
        Sign out
      </button>

      <div className="version-text">ReefVPN v1.0.0</div>
    </div>
  );
}
