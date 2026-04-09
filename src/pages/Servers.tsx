import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
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

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-dim)" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="6" cy="6" r="4"/>
      <path d="M10 10l2.5 2.5"/>
    </svg>
  );
}

// ─── Country code helper ─────────────────────────────────────────────────────

const COUNTRY_CODES: Record<string, string> = {
  'netherlands': 'NL', 'germany': 'DE', 'france': 'FR', 'sweden': 'SE',
  'finland': 'FI', 'norway': 'NO', 'denmark': 'DK', 'switzerland': 'CH',
  'austria': 'AT', 'spain': 'ES', 'italy': 'IT', 'poland': 'PL',
  'czechia': 'CZ', 'romania': 'RO', 'ukraine': 'UA', 'russia': 'RU',
  'united kingdom': 'GB', 'uk': 'GB', 'usa': 'US', 'united states': 'US',
  'canada': 'CA', 'japan': 'JP', 'singapore': 'SG', 'australia': 'AU',
  'hong kong': 'HK', 'brazil': 'BR', 'india': 'IN',
};

function countryCode(name: string) {
  return COUNTRY_CODES[name.toLowerCase()] || name.slice(0, 2).toUpperCase();
}

function loadLabel(load: number): { text: string; color: string } {
  if (load > 0.7) return { text: 'High', color: '#ff6b6b' };
  if (load > 0.4) return { text: 'Medium', color: '#ffb347' };
  return { text: 'Low', color: '#4ecdc4' };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerNode {
  id: string;
  name: string;
  host: string;
  port: number;
  country: string;
  city?: string;
  load?: number;
  is_active?: boolean;
}

interface Country {
  name: string;
  nodes: ServerNode[];
  ping?: number;
  avgLoad: number;
  isAvailable: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Servers() {
  const navigate = useNavigate();
  const { currentServer, setCurrentServer, connected } = useAppStore();
  const [countries, setCountries] = useState<Country[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const countryList: string[] = await api.listCountries();
        const grouped: Country[] = await Promise.all(
          countryList.map(async (name) => {
            const nodes: ServerNode[] = await api.listNodes(name).catch(() => []);
            const activeNodes = nodes.filter((n) => n.is_active !== false);
            const isAvailable = activeNodes.length > 0;
            const avgLoad = activeNodes.length > 0
              ? activeNodes.reduce((sum, n) => sum + (n.load || 0), 0) / activeNodes.length
              : 0;

            let ping: number | undefined;
            if (!connected && activeNodes.length > 0 && activeNodes[0].host) {
              try {
                const ms = await invoke<number>('measure_ping', { host: activeNodes[0].host, port: 8443 });
                ping = ms > 0 ? ms : undefined;
              } catch {}
            }

            return { name, nodes: activeNodes, ping, avgLoad, isAvailable };
          })
        );
        grouped.sort((a, b) => {
          if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
          return (a.ping || 999) - (b.ping || 999);
        });
        setCountries(grouped);
      } catch {
        setCountries([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = countries.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  function handleSelect(country: Country) {
    if (!country.isAvailable) return;
    if (country.nodes.length > 0) {
      setCurrentServer(country.name);
    }
    navigate('/');
  }

  return (
    <div className="page-content" style={{ paddingTop: 0 }}>
      {/* Back header */}
      <div className="back-header" style={{ paddingTop: 40 }}>
        <button className="back-btn" onClick={() => navigate('/')}>
          <IconBack />
        </button>
        <span className="page-title">Servers</span>
      </div>

      {/* Search */}
      <div className="search-wrap">
        <IconSearch />
        <input
          className="search-input"
          placeholder="Search countries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
          Loading servers...
        </div>
      ) : (
        <div>
          {filtered.map((country) => {
            const isSelected = currentServer === country.name;
            const { text: loadText, color: loadColor } = loadLabel(country.avgLoad);

            return (
              <div
                key={country.name}
                className="server-item"
                onClick={() => handleSelect(country)}
                style={{ opacity: country.isAvailable ? 1 : 0.4, cursor: country.isAvailable ? 'pointer' : 'default' }}
              >
                <div className="country-flag">{countryCode(country.name)}</div>
                <div className="server-item-body">
                  <div className="server-item-name">{country.name}</div>
                  <div className="server-item-sub">
                    {!country.isAvailable ? 'Unavailable' : `${country.nodes.length} server${country.nodes.length > 1 ? 's' : ''}`}
                  </div>
                </div>
                {country.isAvailable && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
                    {country.ping && (
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{country.ping}ms</span>
                    )}
                    <span style={{ fontSize: 10, color: loadColor, fontWeight: 600 }}>{loadText}</span>
                  </div>
                )}
                <div className={`radio-circle ${isSelected ? 'active' : ''}`}>
                  {isSelected && <div className="radio-dot" />}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
              No servers found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
