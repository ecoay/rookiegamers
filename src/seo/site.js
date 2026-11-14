// The canonical host for public pages. Deliberately not env.SITE_URL: that binding also feeds the
// auth token issuer and share/promotion URLs (see dev.js siteURL), so changing it is a separate,
// riskier decision (HANDOFF.md). Canonical tags and JSON-LD @id/url values always point at the apex.

export const APEX = 'https://rookiegamers.com';

export const canonical = path => APEX + path;

const U2028 = String.fromCharCode(0x2028), U2029 = String.fromCharCode(0x2029);

// Safe to inline inside <script type="application/ld+json">: escape </script> and the line/
// paragraph separators, which are legal in JSON strings but break some JS engines as raw script text.
export const ldJSON = obj => JSON.stringify(obj).replace(/</g, '\\u003c').split(U2028).join('\\u2028').split(U2029).join('\\u2029');

// Standard Google Analytics 4 snippet. One constant so every public HTML head stays in lockstep.
export const GA_MEASUREMENT_ID = 'G-K05JD2HSXT';
export const GA4_HEAD = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '${GA_MEASUREMENT_ID}');</script>`;

