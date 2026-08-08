import { useEffect, useState } from 'react';
import { api } from './api';

type Health = { status: string; instance: string; uptime: number };

/**
 * Placeholder shell. The booking flow (browse -> seat grid -> hold -> OTP ->
 * pay -> confirm) lands in a later slice.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(e instanceof Error ? e.message : 'unreachable'));
  }, []);

  return (
    <main>
      <header>
        <h1>CinemaSeat</h1>
        <p className="sub">Never sells the same seat twice.</p>
      </header>

      <div className="card">
        {error && <p>API unreachable: {error}</p>}
        {!error && !health && <div className="skeleton" />}
        {health && (
          <p className="sub">
            API <span className="badge active">{health.status}</span> · instance{' '}
            <code>{health.instance}</code>
          </p>
        )}
      </div>
    </main>
  );
}

// Keep the typed client referenced so the module is not tree-shaken away
// before the booking flow lands.
export const _client = api;
