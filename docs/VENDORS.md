# Vendors and subprocessors

NFR-08 and CR-13: every service that touches customer data is listed here, with
what it receives. BUD-05: free-tier limits marked "verify" were not confirmed
from the vendor at the time of writing; record the real limits when each account
is created. Figures marked from RESEARCH are third-party summaries dated
2026-10-06, not vendor-confirmed unless noted.

| Vendor | Purpose | Data it receives | Plan | Limits to watch | Status |
| --- | --- | --- | --- | --- | --- |
| Supabase | Postgres, Auth, Storage | All tenant data | Free until the first real customer record, then Pro (BUD-02, CR-09) | Free: 500 MB DB, pauses after 7 idle days, no backups (RESEARCH R-TECH-01). Pro: $25/mo, daily backups 7 days (R-TECH-02) | Not created. Owner creates the project |
| Netlify | Hosting | Request logs | Free (commercial use allowed) | 300 credits/month on new accounts, sites pause at the cap (R-TECH-03). Deploy from `main` only, previews off (BUD-04) | Not created. OQ-01 |
| Google Maps Platform | Geocoding; later, the route optimization adapter (D-07) | Street addresses and coordinates only. Never names, phones, emails or notes (enforced in `lib/providers/geocoder.ts`, tested) | Free monthly allowance | 10,000 calls per Essentials SKU (R-TECH-08, vendor-confirmed); route optimization 5,000 shipments free (R-TECH-09) | Optional. Without a key, pins are placed by hand. The optimizer adapter is not built; routes are ordered on our own server |
| Map tile host (owner's choice) | Street map behind the board and pin checks (D-08) | The viewer's IP address and which map areas are viewed, which shows where customers are at street level. No names or other fields | Depends on the host. OpenFreeMap: free, no key. Self-hosted PMTiles (Protomaps): no third party at all | Verify the host's usage policy before pointing production at it | Off by default (`NEXT_PUBLIC_MAP_STYLE_URL` empty): no tile requests |
| Inngest | Durable background jobs | Job payloads (ids, not customer details) | Free | Verify at signup | Not created |
| PowerSync | Offline sync (D-06) | Synced subset of tenant data | Cloud Free | 2 GB/month, 50 peak connections, deactivated after 1 idle week (R-TECH-06, vendor-confirmed) | Not used: the built-in sync adapter covers M3 with no third party. Owner decides whether to add it |
| Stripe | Payments (M4) and RouteKeep's own subscription billing | Payment details entered in Stripe-hosted fields; customer name and email for receipts | Connect, Standard-style accounts | Processing fees paid by the tenant (R-TECH-07) | Not created |
| Resend | Email (M6) | Recipient email, message content | Free | Verify at signup | Not created |
| Twilio | SMS after 10DLC approval (M6) | Recipient phone, message content | Pay as you go, passed through to tenant | 10DLC brand and campaign fees (R-TECH-10) | Not created |
| Sentry | Error tracking | Error traces with tenant and request ids; scrub personal data before enabling | Free | Verify at signup | Not configured |
| GitHub | Code, CI | Source code; no customer data | Free | Actions minutes | In use |

Not subprocessors: fonts (Geist is bundled with the app; no font CDN), icons
(bundled), the map library (MapLibre GL, bundled; it has no telemetry, and its
worker is served from our own domain, see `scripts/vendor/copy-assets.mjs`).
