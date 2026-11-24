#!/usr/bin/env bash
# One-time database setup for PGBX on Google Cloud SQL, run in Google Cloud Shell (project pgbx-ac0f5):
#
#   cd ~/pgbx-app && git pull && bash scripts/cloudshell-setup.sh
#
# It makes a random database password inside Cloud Shell (never shown), creates or resets the pgbx_app user, sets up
# every table, creates the first admin account, and stores the database connection string in Google Secret Manager,
# where the server reads it (DATABASE_URL_SECRET=pgbx-database-url). Nothing secret has to be copied anywhere.
# The admin's one-time password and authenticator secret are written to ~/pgbx-admin-login.txt (readable only by you).
# Safe to run again: tables already set up are skipped, the password is replaced, and an existing admin is kept.
set -euo pipefail
umask 077
INSTANCE=pgbx-db; DB=pgbx; USER=pgbx_app; SECRET=pgbx-database-url
ADMIN_EMAIL="${ADMIN_EMAIL:-dewanxlakhmir@gmail.com}"; ADMIN_NAME="${ADMIN_NAME:-Syed Ahmad Hassan}"
PROJECT=$(gcloud config get-value project 2>/dev/null)
SA="firebase-adminsdk-fbsvc@${PROJECT}.iam.gserviceaccount.com"
cd "$(dirname "$0")/.."

echo "1/6 Packages"; npm ci --omit=dev --silent --no-audit --no-fund
echo "2/6 Database server"
IP=$(gcloud sql instances describe "$INSTANCE" --format='value(ipAddresses[0].ipAddress)')
gcloud sql databases describe "$DB" --instance="$INSTANCE" >/dev/null 2>&1 || gcloud sql databases create "$DB" --instance="$INSTANCE" --quiet
echo "3/6 Database user (new random password)"
P=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 || true)
if gcloud sql users list --instance="$INSTANCE" --format='value(name)' | grep -qx "$USER"; then
  gcloud sql users set-password "$USER" --instance="$INSTANCE" --host=% --password="$P" --quiet >/dev/null
else
  gcloud sql users create "$USER" --instance="$INSTANCE" --password="$P" --quiet >/dev/null
fi
export DATABASE_URL="postgres://${USER}:${P}@${IP}:5432/${DB}"
echo "4/6 Tables"; npm run --silent db:migrate
echo "5/6 Admin account"
if node -e "import('./server/db.mjs').then(async m=>{const d=await m.connectPostgres(process.env.DATABASE_URL);const r=await d.one('select 1 from staff where email=\$1',[process.argv[1]]);await d.close();process.exit(r?0:1)})" "$ADMIN_EMAIL"; then
  echo "    admin $ADMIN_EMAIL already exists (kept)"
else
  npm run --silent staff:create -- --email "$ADMIN_EMAIL" --name "$ADMIN_NAME" --role admin > ~/pgbx-admin-login.txt
  echo "    created; its one-time password and authenticator secret are in ~/pgbx-admin-login.txt"
fi
echo "6/6 Secret Manager"
gcloud services enable secretmanager.googleapis.com --quiet
if gcloud secrets describe "$SECRET" >/dev/null 2>&1; then printf '%s' "$DATABASE_URL" | gcloud secrets versions add "$SECRET" --data-file=- --quiet >/dev/null
else printf '%s' "$DATABASE_URL" | gcloud secrets create "$SECRET" --data-file=- --replication-policy=automatic --quiet >/dev/null; fi
gcloud secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:${SA}" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
unset P DATABASE_URL
echo "PGBX DATABASE SETUP COMPLETE"
