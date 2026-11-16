# PGBX: how we are building it and what is required

Last updated 16 November 2026. Owner: DXL Solutions (Syed Ahmad Hassan).

## 1. What we are building

| Part | What it does | Where it runs |
|---|---|---|
| Customer app | Live prices, buy and sell with the final rate confirmed by PGBX in chat, wallet, collect at dealers, $1 gold, gifts, appraisals, alerts | Android and iPhone apps (Capacitor), and the web at `/live` |
| Admin panel | PGBX staff: orders, identity checks, rate chats, refunds, payouts, dealers, stock, settings, activity log | Web, `/admin` |
| Dealer app | Counter staff: look up the collection code, check the CNIC, hand over the bar | Web, `/dealer` |
| Server (API) | Business rules, payments, identity checks, SMS login, push notifications, scheduled jobs | Vercel (serverless) |
| Database | Accounts, orders, metal and money records (append only), audit log | Postgres (Supabase), not set up yet |
| Push notifications | Phone notifications | Firebase project `pgbx-ac0f5` |

How it fits together:

```
Phone app / web app / admin / dealer
              │  HTTPS
              ▼
     Server on Vercel (pgbx-app.vercel.app, later PGBX's domain)
       │            │             │              │
   Database     SMS provider   Payment gateway  Identity provider
   (Supabase)   (login codes)  (to choose)      (to choose)
       │
   Firebase (push notifications only)
```

## 2. Where everything lives

| Item | Location | Status |
|---|---|---|
| Code | GitHub `ateeqtrades/pgbx-app`, branch `claude/pgbx-mobile-prototype-xjq1vu` | Done. Public: make it private. Move to DXLSolutions once access works. |
| Ibrahim's code | GitHub `DXLSolutions/pgbx-frontend`, `DXLSolutions/pgbx-backend` | No access yet (see section 6) |
| Hosting | Vercel project `pgbx-app` | Live: https://pgbx-app.vercel.app |
| Firebase | Project `pgbx-ac0f5` (Blaze plan) | Android app registered, fingerprints added, push key in Vercel |
| Google Play | DXL Solutions developer account, app `com.dxl.pgbx` | Closed testing active, upload key reset requested |
| Apple | DXL Solutions developer account | Not started |
| Android upload key | `pgbx-upload.jks` + `KEY-DETAILS-KEEP-SECRET.txt` | With Ahmad. Never in git or chat. |
| App ID | `com.dxl.pgbx` (Android and iPhone) | Fixed, cannot change |

## 3. Status today

**Done**
- Customer app, admin panel and dealer app built; four full audits; about 400 automated tests passing.
- Store material: privacy policy, terms, account deletion page, listing text, privacy answers.
- App ID switched to `com.dxl.pgbx`; Firebase Android config added; push key set in Vercel.
- New Android upload key made; reset requested in Play Console (about 2 days).

**In progress**
- Android release build (signing is set up in the code; the build runs once the key reset is approved).
- Closed testing: 13 testers added, 3 opted in. Need 12 or more opted in for 14 days in a row.

**Blocked, waiting on**
- PGBX: payment gateway, identity provider, licence documents, authorisation letter, Shariah approval, lawyer review, business settings.
- DXL: DXLSolutions GitHub access, Apple account, iOS app in Firebase, database account.

## 4. Ibrahim's earlier app (inherited)

- What it is: phone login (Firebase) plus a profile and service request forms. Requests were to be handled by staff in the Firebase console. No buying, payments, wallet, admin panel or dealer app.
- Problem: login fails with "This device could not be verified". All console settings are now correct, so the cause is in his code (possibly Firebase's carrier based phone verification, which may not support Pakistani networks).
- Decision: replace it with our app on the same Play listing. Keep his repositories as reference. Keep the one Firebase user record if it is a real person.

## 5. Release path

### Android (Google Play)
1. Google approves the upload key reset (about 2 days after 16 Nov).
2. Build the signed app bundle (section 8) and upload it to Closed testing.
3. Testers update automatically. Keep at least 12 opted in for 14 days in a row (the clock starts when the 12th opts in).
4. During the 14 days: testers use the app, we collect feedback in a WhatsApp group and push at least one update.
5. Apply for production: answer Google's questions on recruiting testers, how they used the app, feedback and changes.
6. Google review (up to about 7 days), then release to production.

### iPhone (App Store)
1. Add DXL's Apple account access; register bundle ID `com.dxl.pgbx`.
2. Add an iOS app in Firebase, download `GoogleService-Info.plist` (not secret), add an APNs key for push.
3. Build on a Mac with Xcode, upload, test with TestFlight (internal, then external).
4. Submit with screenshots, privacy answers, review login and PGBX's licence and authorisation letter. Review 1 to 3 days. Apple may require the provider (PGBX) to own the listing for a finance app; fallback: PGBX enrols and adds DXL as admin.

## 6. What is required, by owner

### DXL Solutions (Ahmad)
- [ ] Save the upload key files in a private, permanent place.
- [ ] Get all 12+ testers opted in (send the opt-in message again to the 10 who have not).
- [ ] Take over Ibrahim's accounts: Firebase owner, GitHub DXLSolutions owner, any hosting or domain he paid for; remove his access.
- [ ] Give this workspace access to DXLSolutions on GitHub: add the `ateeqtrades` account to the organisation and install the Claude GitHub App on it.
- [ ] Make `ateeqtrades/pgbx-app` private.
- [ ] Delete the exposed Firebase key starting `36da4bf6` (if not done).
- [ ] Apple: confirm access to the DXL developer account; add an iOS app in Firebase.
- [ ] Supabase account (or access) for the production database.
- [ ] Graphics: 512x512 icon, 1024x500 feature graphic, screenshots.

### PGBX
- [ ] Authorisation letter allowing DXL Solutions to publish the PGBX app.
- [ ] Licence or registration documents for dealing in precious metals.
- [ ] Choose a payment gateway and an identity check (CNIC) provider.
- [ ] SMS provider for login codes (local provider recommended, or Twilio).
- [ ] Written Shariah approval; lawyer's review of terms and privacy policy.
- [ ] Business settings: premiums, spread, limits, fees, payout times, dealer list, opening stock with serial numbers, record retention period.
- [ ] Support staff for the rate chat during testing and after launch.

### Development (Claude Code)
- [ ] Android release build as soon as the key reset is approved.
- [ ] Connect the payment gateway (2 to 4 days) and identity provider (3 to 5 days) once chosen.
- [ ] Optional: local SMS provider (about 1 day), or Firebase phone login if preferred.
- [ ] Set up the production database, settings and staff accounts.
- [ ] Move the code to DXLSolutions GitHub.
- [ ] iPhone build support and store submissions.

## 7. Timeline (from the day the inputs above arrive)

| Week | Work |
|---|---|
| 1 | Key reset approved, Android build in closed testing, database and settings set up |
| 1 to 2 | Payment and identity providers connected; testing with PGBX staff and dealers |
| 2 to 3 | Real money pilot (small purchases, one collection, one sell back); fixes |
| 3 | Apply for Play production (once the 14 days are complete); iPhone submission |
| 4 | Store reviews and launch |

## 8. How to build the Android app (for whoever builds it)

Needs: Java 21, Android SDK (platform 36, build tools 36), Node 22.

```bash
npm ci && npm run build:app            # production web build into dist/
cd mobile && npm ci && npx cap sync android
# mobile/android/keystore.properties (never commit it):
#   storeFile=/full/path/to/pgbx-upload.jks
#   storePassword=...
#   keyAlias=pgbx-upload
#   keyPassword=...
cd android && ./gradlew bundleRelease -PversionCode=<higher than the last upload> -PversionName=1.0.0
# upload: mobile/android/app/build/outputs/bundle/release/app-release.aab
```

Check the last version code in Play Console › App bundle explorer before building; each upload needs a higher number.

## 9. Running costs (estimate, about 1,000 active customers)

- To start: about PKR 11,500 (domain, Mac rental for the iPhone build).
- Monthly: about PKR 76,600 (hosting, database, SMS, identity checks).
- First year: about PKR 9.3 lakh, plus payment gateway fees (a percentage of sales).

## 10. Security rules

- Keys and passwords never go in git, chat or email. Upload key files stay with Ahmad; server secrets live only in Vercel settings.
- Public files are fine to share: `google-services.json`, `GoogleService-Info.plist`, certificate `.pem` files, fingerprints.
- Anyone who leaves the company loses access the same day (Play, Firebase, GitHub, Vercel, Supabase).
