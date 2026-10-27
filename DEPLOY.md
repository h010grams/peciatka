# Deployment: Render + Neon

A single container (see `Dockerfile`) serves the API, the web app and the PassKit Web Service from one domain.
Database migrations run automatically on start (`prisma migrate deploy`).

Live instance: https://peciatka.onrender.com

> **HTTPS is required:** Apple Wallet (`webServiceURL`), the in-browser camera and Secure cookies don't work without it.
> Render provides HTTPS automatically, both on its `onrender.com` subdomain and on a custom domain.

## 1. Database — Neon

1. https://neon.tech → New project → region **Frankfurt (eu-central-1)** (close to Slovakia, data stays in the EU).
2. **Connect** → copy the **direct connection string** (no `-pooler` in the host name) — Prisma migrations need a direct connection.
   Remove `&channel_binding=require` from the end; `sslmode=require` keeps the connection encrypted.
   Format: `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. To rotate the password: **Connect → Reset password** (or Branches → branch → Roles & Databases), then update `DATABASE_URL` on Render.
4. Point-in-time restore: the free tier keeps history only briefly; use a paid plan for production.

Supabase works too: Project Settings → Database → Connection string → **Session mode / direct**.

## 2. Application — Render

1. Push the code to GitHub.
2. https://render.com → New → **Web Service** → connect the repository.
3. Language **Docker**, branch `main`, region **Frankfurt** (same as the database).
4. Instance type:
   - **Free** for testing. The service sleeps after ~15 minutes without traffic; the first request then takes up to a minute, and background jobs (Wallet sync, reminders) pause while it sleeps.
   - **Starter** for real salons — always on, so Wallet updates and reminders go out on time.
5. Advanced → Health Check Path: `/api/health`.
6. Environment variables (minimum):

| Variable | Value |
|---|---|
| `DATABASE_URL` | connection string from Neon |
| `APP_URL` | e.g. `https://peciatka.onrender.com` (no trailing `/`) — **exactly the address clients see** |
| `NODE_ENV` | `production` |
| `APP_NAME` | service name |
| `RESEND_API_KEY` | Resend API key (section 4) |
| `MAIL_FROM` | `Pečiatka <noreply@example.sk>` |

`PORT` is set by Render; the server reads it. Wallet variables are described in sections 5 and 6.
Saving changes on the **Environment** tab redeploys the service.

The service address is shown under its name at the top of the service page. If the name was taken, Render adds a suffix — update `APP_URL` to match.

### Other hosts
Any host that builds a `Dockerfile` works (Railway, Fly.io, a VPS with Docker): set the same variables and the health check path.

### Scaling
Background jobs (Wallet sync, reminders) run inside the same process. Multiple instances are safe: jobs are claimed with `FOR UPDATE SKIP LOCKED` and reminders are marked atomically. One instance is enough for the MVP.

## 3. Custom domain

Buy a domain → Render: service → Settings → **Custom Domains** → add the domain → add the CNAME record at your registrar → wait for the certificate.
Then **update `APP_URL`**. The address is printed on QR posters and embedded in Wallet cards, so choose it before printing posters.

## 4. Email — Resend

1. https://resend.com → Domains → add your domain → add the DNS records (SPF, DKIM) at your registrar.
2. API Keys → create a key → `RESEND_API_KEY`.
3. Without a key, emails (invitations, password reset) are only written to the server log.

## 5. Apple Wallet

Requires an Apple Developer Program membership.

1. Generate a private key and a certificate signing request (keep the key secret; `certs/` is git-ignored):
   ```bash
   openssl req -new -newkey rsa:2048 -nodes -keyout certs/signerKey.pem -out certs/pass.certSigningRequest -subj "/CN=Pass Type ID/C=SK"
   ```
2. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → **+** → **Pass Type IDs** → e.g. `pass.sk.peciatka.loyalty`.
3. Open the Pass Type ID → **Create Certificate** → upload `pass.certSigningRequest` → download `pass.cer`.
4. Convert the certificate and download Apple's WWDR G4 intermediate certificate (apple.com/certificateauthority):
   ```bash
   openssl x509 -inform der -in pass.cer -out certs/signerCert.pem
   ```
   ```bash
   openssl x509 -inform der -in AppleWWDRCAG4.cer -out certs/wwdr.pem
   ```
5. Locally, the files in `certs/` are picked up automatically. For hosting, pass them as base64 variables (multi-line PEM in one line):
   ```bash
   base64 -i certs/signerCert.pem | pbcopy
   ```
   → `APPLE_SIGNER_CERT_B64`; likewise `signerKey.pem` → `APPLE_SIGNER_KEY_B64`, `wwdr.pem` → `APPLE_WWDR_CERT_B64`.
   Also set `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID` and, if the key is encrypted, `APPLE_SIGNER_KEY_PASSPHRASE`.

**Check:** the startup log shows `Wallet: Apple on`. On an iPhone, open a client card (`/c/...`) in Safari → "Add to Apple Wallet".
If the card can't be added, check the log: Wallet reports errors to `/api/wallet/apple/v1/log`.

**Remember:** the Pass Type ID certificate is valid for **1 year**. Renew it a month ahead and update the variables — already issued cards keep working.

## 6. Google Wallet

1. Google Cloud: create a project → enable **Google Wallet API** → IAM → Service Accounts → create → Keys → Add key → JSON.
2. https://pay.google.com/business/console → Google Wallet API → copy the **Issuer ID** → Users → invite the service account email with the Developer role.
3. Locally, save the key as `certs/google-sa.json`. For hosting:
   ```bash
   base64 -i service-account.json | pbcopy
   ```
   → `GOOGLE_WALLET_SA_KEY_B64`, plus `GOOGLE_WALLET_ISSUER_ID`.

**Demo mode:** until Google approves publishing, cards are marked "TEST ONLY" and can be saved only by accounts added in the Wallet Console.
When everything works: Wallet Console → **Request publishing access** (business details and screenshots of the flow are required).

**Check:** the startup log shows `Wallet: Google on`. On Android, open `/c/...` → "Add to Google Wallet".

## 7. Post-deployment checklist (on real phones)

1. `https://your-domain/api/health` → `{"ok":true}`.
2. Register a salon, create the program, upload a logo.
3. Download the A4 poster, print it, scan it with an iPhone and an Android phone.
4. Sign up as a client → add the card to Apple Wallet and Google Wallet.
5. On a second phone, log in as staff (invite yourself with another email) → Scanner → scan the QR code in Wallet → **+1 stamp**.
   Within seconds the card updates and a notification arrives.
6. Set the cooldown to 0 hours, collect stamps up to the reward → reward notification → redeem.
7. Set the next appointment two days ahead → the date appears on the card; the reminder arrives a day before.
8. Delete the test client → the card in Wallet becomes void.
9. Staff: Safari → Share → **Add to Home Screen** — the scanner opens like an app.

## 8. Operations

- **Logs:** Render → service → **Logs**. Wallet sync errors are tagged `[wallet]`.
- **Backups:** Neon point-in-time restore; test a restore on a copy once a month.
- **New migrations:** locally `pnpm --filter api db:migrate --name <name>` → commit → the deployment applies them.
- **Legal:** the consent text and the `/j/<salon>/privacy` page are templates — have them reviewed by a lawyer and sign a data processing agreement with each salon (Art. 28 GDPR). When the consent text changes, bump `CONSENT_VERSION` in `packages/shared/src/index.ts`.
- **Wallet buttons:** before a public launch, replace the text buttons with the official "Add to Apple Wallet" and "Add to Google Wallet" badges, as both platforms' brand guidelines require.
