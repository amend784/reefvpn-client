import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, saveToken } from '../lib/api';
import { useAppStore } from '../lib/store';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setLoggedIn, setAccountNumber, setSubscription } = useAppStore();

  async function preloadAccount() {
    const me = await api.getMe();
    if (me?.account_number) {
      setAccountNumber(me.account_number);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.loginWithEmail(email, password);
      saveToken(data.token);
      if (data.user?.account_number) {
        setAccountNumber(data.user.account_number);
      } else {
        await preloadAccount();
      }
      api.getSubscription().then((subscription) => setSubscription(subscription)).catch(() => {});
      setLoggedIn(true);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    setLoading(true);
    setError('');

    try {
      const data = await api.registerWithEmail(email, password);
      saveToken(data.token);
      if (data.user?.account_number) {
        setAccountNumber(data.user.account_number);
      }
      setLoggedIn(true);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  }

  const isSubmitDisabled = loading || !email.trim() || password.length < 8;

  return (
    <div className="login-page">
      <div className="login-logo">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <path d="M13 3C7.477 3 3 7.477 3 13s4.477 10 10 10 10-4.477 10-10S18.523 3 13 3z" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" fill="none"/>
          <ellipse cx="13" cy="13" rx="4" ry="10" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" fill="none"/>
          <line x1="3" y1="13" x2="23" y2="13" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2"/>
        </svg>
      </div>

      <div className="login-title">Sign in</div>
      <div className="login-subtitle">Use email and password for the desktop app.</div>

      <form className="login-form" onSubmit={handleLogin}>
        <div className="input-group">
          <label className="input-label">Email</label>
          <input
            className="input-field"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            spellCheck={false}
          />
        </div>

        <div className="input-group">
          <label className="input-label">Password</label>
          <input
            className="input-field"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            spellCheck={false}
          />
        </div>

        {error && <p className="error-msg">{error}</p>}

        <button type="submit" className="btn-primary" disabled={isSubmitDisabled} style={{ marginTop: '4px' }}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <div className="divider" style={{ width: '100%', margin: '12px 0' }}>or</div>

      <button className="btn-outline" onClick={handleRegister} disabled={isSubmitDisabled} style={{ width: '100%' }}>
        {loading ? 'Creating account...' : 'Create account'}
      </button>

      <p className="login-hint">Desktop auth now matches the production email flow.</p>
    </div>
  );
}
