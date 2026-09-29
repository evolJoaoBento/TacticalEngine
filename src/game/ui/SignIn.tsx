/**
 * Signing in, before the main menu, when the server keeps accounts (`accounts.ts`, `tools/accounts.ts`):
 * a name and a password, and Sign in - or Create account, to make one with them. Signed in, the menu
 * shows that player's games and saves, and the store knows who they are.
 */

import { useState } from 'preact/hooks';
import { signIn, type SignedIn } from '../accounts';
import './menu.css';

export function SignIn(props: { onSignedIn: (account: SignedIn) => void }): preact.JSX.Element {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const go = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    const answer = await signIn(name.trim(), password, creating);
    setBusy(false);
    if ('refused' in answer) setRefused(answer.refused);
    else props.onSignedIn(answer);
  };

  return (
    <div className="menu" data-testid="sign-in">
      <form
        className="menu-card menu-sign-in"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <h1 className="menu-title">Tactical Engine</h1>
        <p className="menu-sub">{creating ? 'Make an account: your games and saves are kept under it.' : 'Sign in to play your own games.'}</p>
        <label className="menu-field">
          Name
          <input data-testid="sign-in-name" value={name} autoComplete="username" maxLength={24} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label className="menu-field">
          Password
          <input data-testid="sign-in-password" type="password" value={password} autoComplete={creating ? 'new-password' : 'current-password'} onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        {refused === null ? null : <p className="menu-refused" role="alert" data-testid="sign-in-refused">{refused}</p>}
        <button type="submit" className="menu-choice is-first" data-testid="sign-in-go" disabled={busy || name.trim() === '' || password === ''}>
          {creating ? 'Create account' : 'Sign in'}
        </button>
        <button type="button" className="menu-back" data-testid="sign-in-switch" onClick={() => { setCreating(!creating); setRefused(null); }}>
          {creating ? 'I have an account' : 'Make an account'}
        </button>
      </form>
    </div>
  );
}
