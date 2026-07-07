import { useState, type FormEvent } from 'react';
import { fetchUsage, type UsageReport } from './api';
import { StatBar } from './components/StatBar';

type Status = 'idle' | 'loading' | 'ok' | 'badpin' | 'disabled' | 'error';

// Round-number money: a few decimals for sub-dollar amounts so cheap days aren't
// shown as "$0.00".
function money(usd: number): string {
  return usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

// Admin-only estimated-spend dashboard (not linked from anywhere). Asks for the
// shared ADMIN_PIN, then shows the Gemini token spend the camera has racked up.
export function SpendPage() {
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [report, setReport] = useState<UsageReport | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pin.length < 3 || status === 'loading') return;
    setStatus('loading');
    const res = await fetchUsage(pin);
    if (res.badPin) return setStatus('badpin');
    if (res.disabled) return setStatus('disabled');
    if (!res.ok || !res.report) return setStatus('error');
    setReport(res.report);
    setStatus('ok');
  }

  return (
    <div className="app">
      <div className="subpage-nav">
        <a className="back-link" href="/">
          ← Back to the birds
        </a>
      </div>

      {status === 'ok' && report ? (
        <Report report={report} />
      ) : (
        <form className="subscribe" onSubmit={submit}>
          <h1>Project spend 💸</h1>
          <p className="subscribe-lead">
            Estimated Gemini cost for the feeder camera. Enter the admin code to view.
          </p>
          <label className="subscribe-label" htmlFor="pin">
            Admin code
          </label>
          <input
            id="pin"
            className="subscribe-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Enter code"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
          />
          {status === 'badpin' && (
            <p className="subscribe-msg-err">That code didn't work — try again.</p>
          )}
          {status === 'disabled' && (
            <p className="subscribe-msg-err">
              The spend tracker is off — set <code>ADMIN_PIN</code> in the project to enable it.
            </p>
          )}
          {status === 'error' && (
            <p className="subscribe-msg-err">Something went wrong — try again in a moment.</p>
          )}
          <button className="subscribe-btn" type="submit" disabled={status === 'loading'}>
            {status === 'loading' ? 'Loading…' : 'Show spend'}
          </button>
        </form>
      )}
    </div>
  );
}

function Report({ report }: { report: UsageReport }) {
  const totalTokens = report.totals.inputTokens + report.totals.outputTokens;
  return (
    <>
      <h1 className="species-table-title" style={{ fontSize: 24, marginTop: 8 }}>
        Estimated project spend 💸
      </h1>
      <StatBar
        stats={[
          { value: report.totals.calls, label: 'API calls' },
          { value: totalTokens, label: 'Tokens' },
        ]}
      />
      <p className="spend-total">
        {money(report.estimatedUsd)} <span className="spend-total-label">estimated to date</span>
      </p>

      <section className="species-table-wrap" aria-label="Spend by day">
        <h2 className="species-table-title">By day</h2>
        {report.days.length === 0 ? (
          <p className="empty">No usage recorded yet.</p>
        ) : (
          <table className="species-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className="species-table-num">
                  Calls
                </th>
                <th scope="col" className="species-table-num">
                  Tokens
                </th>
                <th scope="col" className="species-table-num">
                  Est. cost
                </th>
              </tr>
            </thead>
            <tbody>
              {report.days.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td className="species-table-num">{d.calls.toLocaleString()}</td>
                  <td className="species-table-num">
                    {(d.inputTokens + d.outputTokens).toLocaleString()}
                  </td>
                  <td className="species-table-num">{money(d.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="spend-note">
        Estimate only — tokens the camera reported × Google's list prices, not your actual bill.
      </p>
    </>
  );
}
