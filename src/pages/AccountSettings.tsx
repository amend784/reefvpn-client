import { useEffect } from 'react';
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccountSettings() {
  const navigate = useNavigate();
  const { accountNumber, subscription, setSubscription } = useAppStore();

  useEffect(() => {
    if (subscription !== null) return;
    api.getSubscription()
      .then((s) => setSubscription(s))
      .catch(() => {});
  }, []);

  const isActive = subscription?.is_active ?? false;
  const expiresAt = subscription?.subscription?.expires_at?.split('T')[0] ?? null;
  const plan = subscription?.subscription?.plan ?? 'Free';

  const displayAccount = accountNumber
    ? accountNumber.length > 20
      ? accountNumber.slice(0, 8) + '...' + accountNumber.slice(-6)
      : accountNumber
    : '--';

  return (
    <div className="page-content" style={{ paddingTop: 0 }}>
      {/* Back header */}
      <div className="back-header" style={{ paddingTop: 40 }}>
        <button className="back-btn" onClick={() => navigate('/settings')}>
          <IconBack />
        </button>
        <span className="page-title">Account</span>
      </div>

      {/* Account card */}
      <div className="account-card">
        <div className="account-number">{displayAccount}</div>
        <div className={`account-status ${isActive ? 'active' : 'inactive'}`}>
          {isActive
            ? `${plan}${expiresAt ? ` · Active until ${expiresAt}` : ''}`
            : 'No active subscription'}
        </div>
      </div>

      {/* Subscription */}
      <div className="section-label">Subscription</div>
      <div className="vpn-row">
        <div className="vpn-row-label">Plan</div>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--accent)' }}>{plan}</span>
      </div>
      <div className="vpn-row">
        <div className="vpn-row-label">Status</div>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: isActive ? 'var(--green)' : 'var(--red)' }}>
          {isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
      {expiresAt && (
        <div className="vpn-row">
          <div className="vpn-row-label">Expires</div>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--accent)' }}>{expiresAt}</span>
        </div>
      )}

      {/* Devices */}
      <div className="section-label" style={{ marginTop: 12 }}>Devices</div>
      <div className="vpn-row">
        <div className="vpn-row-label" style={{ color: 'var(--muted)', fontSize: 12 }}>
          Device management coming soon
        </div>
      </div>
    </div>
  );
}
