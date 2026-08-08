import { useEffect, useState } from 'react';
import { api } from './api';

type Item = {
  id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  created_at: string;
};

type ListResponse = { data: Item[]; pagination: { nextCursor: string | null } };

/**
 * Placeholder UI. Replace with the real screens.
 *
 * Keep the three states below in whatever you build: LOADING (skeleton),
 * ERROR (with a retry affordance), EMPTY. On venue Wi-Fi these are the
 * difference between "it's slow" and "it's broken" during your demo.
 */
export function App() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setItems(null);
    api<ListResponse>('/v1/items?limit=20')
      .then((r) => setItems(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Request failed'));
  };

  useEffect(load, []);

  return (
    <main>
      <header>
        <h1>Zero to Production</h1>
        <p className="sub">Starter kit — replace this with the real application.</p>
      </header>

      {error && (
        <div className="card error">
          <p>Could not reach the API: {error}</p>
          <button onClick={load}>Retry</button>
        </div>
      )}

      {!error && items === null && (
        <div className="card">
          {/* Skeleton, not a spinner — perceived performance on slow links. */}
          <div className="skeleton" />
          <div className="skeleton short" />
        </div>
      )}

      {items?.length === 0 && (
        <div className="card">
          <p>No items yet. Run the seed script to populate demo data.</p>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="list">
          {items.map((item) => (
            <li key={item.id} className="card">
              <div className="row">
                <strong>{item.title}</strong>
                <span className={`badge ${item.status}`}>{item.status}</span>
              </div>
              {item.description && <p className="sub">{item.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
