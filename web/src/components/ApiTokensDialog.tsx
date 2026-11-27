// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState, type FormEvent } from 'react';
import type { ApiToken } from '@shared/types';
import { api } from '../api';
import { formatRelative } from '../lib/format';

export default function ApiTokensDialog({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.listTokens().then(setTokens, (e) => setError((e as Error).message));
  useEffect(() => { load(); }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const t = await api.createToken(name.trim());
      setCreated(t.token);
      setCopied(false);
      setName('');
      load();
    } catch (err) { setError((err as Error).message); }
  };
  const revoke = async (id: string) => {
    try { await api.revokeToken(id); load(); } catch (err) { setError((err as Error).message); }
  };
  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created); setCopied(true); } catch { setError('Copy failed; select the token and copy it manually.'); }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="tok-title"
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2 id="tok-title">API tokens</h2>
        <p className="muted">For OPDS and KOReader clients: use any username and the token as the password.</p>
        {created && (
          <div>
            <div className="sync-line"><strong>Copy it now, it will not be shown again.</strong></div>
            <input className="side-input" readOnly value={created} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        )}
        {tokens.length === 0 ? <div className="menu-empty">No tokens yet</div> : tokens.map((t) => (
          <div className="sync-line" key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{t.name} <span className="muted">· {t.lastUsedAt ? `used ${formatRelative(t.lastUsedAt)}` : 'never used'}</span></span>
            <button className="btn btn-danger-quiet" type="button" onClick={() => revoke(t.id)}>Revoke</button>
          </div>
        ))}
        <form onSubmit={create} style={{ display: 'flex', gap: 8 }}>
          <input className="side-input" placeholder="Token name (e.g. Kobo)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>Create</button>
        </form>
        {error && <div className="sync-err" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="btn" type="button" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
