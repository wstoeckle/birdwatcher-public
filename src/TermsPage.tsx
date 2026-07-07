import { SITE_TITLE, SITE_URL, CONTACT_EMAIL } from './siteConfig';

// SMS terms & conditions for the optional alerts — required for the Twilio A2P
// 10DLC campaign registration. The site name, URL, and contact email come from
// src/siteConfig.ts — edit them there.
export function TermsPage() {
  return (
    <div className="app">
      <div className="subpage-nav">
        <a className="back-link" href="/">
          ← Back to the birds
        </a>
      </div>
      <article className="legal">
        <h1>SMS Terms &amp; Conditions</h1>
        <p className="legal-meta">{SITE_TITLE} · last updated June 2026</p>

        <p>
          By opting in, you agree to receive text-message (SMS/MMS) alerts from the {SITE_TITLE}{' '}
          bird-and-wildlife feeder camera — photos and notifications when the camera spots a bird
          or other wildlife at <a href={SITE_URL}>{SITE_URL.replace(/^https?:\/\//, '')}</a>.
        </p>

        <ul>
          <li>
            <strong>Program:</strong> {SITE_TITLE} alerts.
          </li>
          <li>
            <strong>Message frequency:</strong> varies; at most a few messages per day.
          </li>
          <li>
            <strong>Cost:</strong> Message and data rates may apply.
          </li>
          <li>
            <strong>Opt-out:</strong> Reply <strong>STOP</strong> at any time to cancel. You'll
            get one confirmation and no further messages.
          </li>
          <li>
            <strong>Help:</strong> Reply <strong>HELP</strong>, or email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </li>
          <li>
            <strong>Carriers:</strong> Mobile carriers are not liable for delayed or undelivered
            messages.
          </li>
          <li>
            <strong>Privacy:</strong> See our <a href="/privacy">Privacy Policy</a>. We do not
            share your mobile number with third parties for marketing.
          </li>
        </ul>

        <p>This is a small private family project, not a commercial service.</p>
      </article>
    </div>
  );
}
