// Per-deployment site identity — edit these when you set up your own bird cam.
// They appear in the page header, the legal pages, and SMS alert sign-up copy.
// (The browser-tab title and meta description live in index.html — update those too.)

export const SITE_TITLE = 'Backyard Bird Cam';

export const SITE_SUBTITLE = 'Photographed at the feeder, identified by AI.';

/** Public URL of this deployment, no trailing slash. Shown on the legal pages. */
export const SITE_URL = 'https://your-domain.example';

/** Contact for privacy/SMS questions. Required if you enable Twilio alerts. */
export const CONTACT_EMAIL = 'you@example.com';
