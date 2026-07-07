import { useState, type FormEvent } from 'react';
import { subscribe } from './api';

type Status = 'idle' | 'sending' | 'done' | 'invalid' | 'error';

// Public opt-in form for text alerts. The consent checkbox carries the
// carrier-required language (recurring messages, msg & data rates, STOP/HELP),
// which is also what the A2P 10DLC campaign points to + screenshots.
export function SubscribePage() {
  const [phone, setPhone] = useState('');
  const [wantsCritters, setWantsCritters] = useState(false);
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (status === 'sending' || !consent) return;
    if (phone.replace(/\D/g, '').length < 10) {
      setStatus('invalid');
      return;
    }
    setStatus('sending');
    const res = await subscribe(phone, wantsCritters, consent);
    setStatus(res.ok ? 'done' : res.invalid ? 'invalid' : 'error');
  }

  return (
    <div className="app">
      <div className="subpage-nav">
        <a className="back-link" href="/">
          ← Back to the birds
        </a>
      </div>

      {status === 'done' ? (
        <div className="subscribe">
          <h1>You're signed up! 🐦</h1>
          <p className="subscribe-lead">
            We'll text you a photo whenever a bird visits the feeder. Reply STOP anytime to opt out.
          </p>
        </div>
      ) : (
        <form className="subscribe" onSubmit={submit}>
          <h1>Get text alerts 🔔</h1>
          <p className="subscribe-lead">
            Want a text with the photo whenever a bird visits the 70 SoC feeder? Pop in your number.
          </p>

          <label className="subscribe-label" htmlFor="phone">
            Mobile number
          </label>
          <input
            id="phone"
            className="subscribe-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <label className="subscribe-check">
            <input
              type="checkbox"
              checked={wantsCritters}
              onChange={(e) => setWantsCritters(e.target.checked)}
            />
            <span>Also text me about non-bird visitors (squirrels, foxes, etc.)</span>
          </label>

          <label className="subscribe-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span className="subscribe-consent">
              I agree to receive recurring automated text messages (bird &amp; wildlife alerts) from
              70 SoC Bird Camera at the number above. Consent is not a condition of any purchase.
              Message frequency varies; message &amp; data rates may apply. Reply STOP to cancel,
              HELP for help. See our <a href="/privacy">Privacy Policy</a> and{' '}
              <a href="/terms">Terms</a>.
            </span>
          </label>

          {status === 'invalid' && (
            <p className="subscribe-msg-err">Please enter a valid US mobile number.</p>
          )}
          {status === 'error' && (
            <p className="subscribe-msg-err">Something went wrong — try again in a moment.</p>
          )}

          <button className="subscribe-btn" type="submit" disabled={!consent || status === 'sending'}>
            {status === 'sending' ? 'Signing up…' : 'Text me bird alerts'}
          </button>
        </form>
      )}
    </div>
  );
}
