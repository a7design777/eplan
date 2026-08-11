import { useState, type FormEvent } from 'react';
import { api, type AuthUser } from '../api';

interface Props {
  onClose: () => void;
  onAuth: (user: AuthUser) => void;
}

export function AuthDialog({ onClose, onAuth }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password);
      onAuth(user);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Вхід' : 'Реєстрація'}</h2>

        <div className="tabs">
          <button
            type="button"
            aria-selected={mode === 'login'}
            onClick={() => { setMode('login'); setError(null); }}
          >
            Увійти
          </button>
          <button
            type="button"
            aria-selected={mode === 'register'}
            onClick={() => { setMode('register'); setError(null); }}
          >
            Створити акаунт
          </button>
        </div>

        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            value={email}
            autoComplete="email"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="auth-password">Пароль</label>
          <input
            id="auth-password"
            type="password"
            value={password}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={8}
            required
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' && <span className="muted">Щонайменше 8 символів.</span>}
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : mode === 'login' ? 'Увійти' : 'Зареєструватись'}
        </button>
        <button className="btn-plain" type="button" onClick={onClose}>
          Скасувати
        </button>
      </form>
    </div>
  );
}
