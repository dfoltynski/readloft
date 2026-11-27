// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { IconLogo } from '../components/Icons';

export default function SetupPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authStatus().then((s) => {
      if (!s.setupRequired) navigate(s.authenticated ? '/' : '/login', { replace: true });
    }, () => {});
  }, [navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError('Password must be at least 10 characters.');
    if (password !== again) return setError('Passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await api.setup(code.trim(), password);
      window.location.assign('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" style={{ position: 'static', minHeight: '100vh' }}>
      <form className="dialog" onSubmit={submit}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconLogo /> Set up Libristead</h2>
        <p className="muted">Enter the setup code printed in the server log (Docker: <code>docker logs libristead</code>) and choose a password.</p>
        <label className="field-label" htmlFor="code">Setup code</label>
        <input id="code" className="side-input" autoComplete="off" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        <label className="field-label" htmlFor="pw1">Password (min. 10 characters)</label>
        <input id="pw1" className="side-input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label className="field-label" htmlFor="pw2">Repeat password</label>
        <input id="pw2" className="side-input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        {error && <div className="sync-err" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button className="btn btn-primary" type="submit" disabled={busy || !code || !password}>{busy ? 'Saving…' : 'Create password'}</button>
        </div>
      </form>
    </div>
  );
}
