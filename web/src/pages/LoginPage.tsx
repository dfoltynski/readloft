// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { IconLogo } from '../components/Icons';

export default function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authStatus().then((s) => {
      if (s.setupRequired) navigate('/setup', { replace: true });
      else if (s.authenticated) navigate('/', { replace: true });
    }, () => {});
  }, [navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      window.location.assign('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" style={{ position: 'static', minHeight: '100vh' }}>
      <form className="dialog" onSubmit={submit}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconLogo /> Libristead</h2>
        <label className="field-label" htmlFor="pw">Password</label>
        <input id="pw" className="side-input" type="password" autoComplete="current-password" autoFocus
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="sync-err" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button className="btn btn-primary" type="submit" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  );
}
