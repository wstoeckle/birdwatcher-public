import { SITE_TITLE, SITE_URL, CONTACT_EMAIL } from './siteConfig';

// Privacy policy for the optional SMS/MMS alerts — required (with these exact
// disclosures) for the Twilio A2P 10DLC campaign registration. The site name,
// URL, and contact email come from src/siteConfig.ts — edit them there.
export function PrivacyPage() {
  return (
    <div className="app">
      <div className="subpage-nav">
        <a className="back-link" href="/">
          ← Back to the birds
        </a>
      </div>
      <article className="legal">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">{SITE_TITLE} · last updated June 2026</p>

        <p>
          {SITE_TITLE} is a small, private family bird-and-wildlife feeder camera at{' '}
          <a href={SITE_URL}>{SITE_URL.replace(/^https?:\/\//, '')}</a>. This policy covers the
          optional text-message (SMS/MMS) alerts you can choose to receive.
        </p>

        <h2>What we collect</h2>
        <p>
          If you ask to receive alerts, we store the mobile phone number you give us. We use it
          only to text you photos and notifications when the camera spots a bird or other wildlife.
        </p>

        <h2>We do not share your number</h2>
        <p>
          We do not sell, rent, or share your mobile number or any opt-in information with third
          parties — except our messaging provider (Twilio), strictly to deliver the texts you
          asked for. No mobile information is shared with anyone for marketing or promotional
          purposes.
        </p>

        <h2>Message frequency, rates, and opt-out</h2>
        <ul>
          <li>Message frequency varies — at most a few messages per day.</li>
          <li>Message and data rates may apply.</li>
          <li>
            Reply <strong>STOP</strong> at any time to stop receiving messages. Reply{' '}
            <strong>HELP</strong> for help.
          </li>
        </ul>

        <h2>Photos</h2>
        <p>
          Photos the camera captures may appear on the public gallery at{' '}
          {SITE_URL.replace(/^https?:\/\//, '')}.
        </p>

        <h2>Contact</h2>
        <p>
          Questions? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </article>
    </div>
  );
}
