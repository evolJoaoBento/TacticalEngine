/**
 * Changing the signed-in account's password, from the main menu (`accounts.ts`, `changePassword`; the server's
 * `accounts.rs`): the one it has now, the new one twice. A friend changes the one the host first gave them; the host
 * changes admin's first password, which then signs in from beyond this machine too.
 */

import { useState } from 'preact/hooks';
import { changePassword } from '../accounts';
import './menu.css';

export function ChangePassword(props: { onBack: () => void }): preact.JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ done: boolean; text: string } | null>(null);
  const mismatch = again !== '' && next !== again;

  const go = async (): Promise<void> => {
    if (busy || mismatch) return;
    setBusy(true);
    setSaid(null);
    const answer = await changePassword(current, next);
    setBusy(false);
    if ('refused' in answer) {
      setSaid({ done: false, text: answer.refused });
      return;
    }
    setCurrent('');
    setNext('');
    setAgain('');
    setSaid({ done: true, text: 'Your password is changed.' });
  };

  return (
    <form
      className="menu-sign-in"
      data-testid="change-password"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <p className="menu-sub">Change your password: the one you have now, then the new one twice.</p>
      <label className="menu-field">
        Password now
        <input data-testid="password-current" type="password" autoComplete="current-password" value={current} onInput={(e) => setCurrent(e.currentTarget.value)} />
      </label>
      <label className="menu-field">
        New password
        <input data-testid="password-next" type="password" autoComplete="new-password" value={next} onInput={(e) => setNext(e.currentTarget.value)} />
      </label>
      <label className="menu-field">
        New password, again
        <input data-testid="password-again" type="password" autoComplete="new-password" value={again} onInput={(e) => setAgain(e.currentTarget.value)} />
      </label>
      {mismatch ? <p className="menu-refused" role="alert">The new password and its repeat differ.</p> : null}
      {said === null ? null : (
        <p className={said.done ? 'menu-sub' : 'menu-refused'} role="alert" data-testid={said.done ? 'password-changed' : 'password-refused'}>
          {said.text}
        </p>
      )}
      <button type="submit" className="menu-choice is-first" data-testid="password-go" disabled={busy || current === '' || next === '' || next !== again}>
        Change password
      </button>
      <button type="button" className="menu-back" data-testid="menu-back" onClick={props.onBack}>
        Back
      </button>
    </form>
  );
}
