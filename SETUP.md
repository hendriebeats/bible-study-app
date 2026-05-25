# Setup — external accounts & credentials

These are the accounts and keys the app needs. You can do this in parallel while
the code is being built. Everything is **free**. Copy `.env.example` →
`.env.local` and fill values as you go.

> **Why SSO works in dev:** Supabase brokers the OAuth flow, so Google
> redirects to **Supabase's** callback (`https://<ref>.supabase.co/auth/v1/callback`),
> not to `localhost`. As long as Supabase's allowed redirect list includes
> `http://localhost:3000`, sign-in works on your machine. You do **not** need a
> public tunnel for dev.

---

## 1. Supabase project (auth + database)

1. Create an account at https://supabase.com → **New project** (pick a region near you).
2. After it provisions, go to **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (server-only secret)
3. Go to **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000`
   - **Redirect URLs**: add `http://localhost:3000/**` (add your production URL later)
4. Note your project ref (the `<ref>` in the Project URL `https://<ref>.supabase.co`).
   Your OAuth callback URL is: **`https://<ref>.supabase.co/auth/v1/callback`** —
   you'll paste this into Google below.

Email/password works immediately once these keys are set (Supabase handles
verification + password-reset emails out of the box).

### 1a. Email templates (so links land in this app)

The app verifies email links at `/auth/confirm`. Update these templates under
**Authentication → Email Templates** so their link uses `token_hash`:

- **Confirm signup** — set the link to:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
- **Reset password** — set the link to:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
- **Change email address** — set the link to:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change`

(Google SSO uses `/auth/callback` instead and needs no template change.)

---

## 2. Google SSO (Google Cloud Console)

1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → OAuth consent screen** → User type **External** → fill in
   app name, support email. While in "Testing", add your own email under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   Application type **Web application**.
4. **Authorized redirect URIs** → add your Supabase callback:
   `https://<ref>.supabase.co/auth/v1/callback`
5. Create → copy **Client ID** and **Client secret**.
6. Supabase Dashboard → **Authentication → Providers → Google** → paste the Client
   ID + secret → **Enable**.

---

## 3. ESV API (scripture text)

1. Create an application key at https://api.esv.org/account/create-application/
   (free for non-commercial use; attribution required).
2. Put the key in `ESV_API_KEY`.

---

## 4. Apply the database schema

The schema lives in `supabase/migrations/`. Link the CLI to your project once,
then push:

```bash
npx supabase login                 # opens browser for an access token
npx supabase link --project-ref <ref>   # <ref> from your Supabase URL
npm run db:push                    # applies migrations to your project
```

(Alternatively, paste the contents of the migration file into the Supabase
dashboard **SQL Editor** and run it.)

Then generate typed DB definitions so queries are fully type-safe:

```bash
npm run gen:types                  # writes src/lib/supabase/database.types.ts
```

---

## 5. Finish

```bash
cp .env.example .env.local   # then fill in the values above
npm run dev                  # http://localhost:3000
```

Checklist:

- [ ] Supabase URL + anon key + service_role key
- [ ] Supabase Site URL + redirect list configured
- [ ] Email templates point at `/auth/confirm`
- [ ] Google provider enabled in Supabase
- [ ] ESV API key
- [ ] `.env.local` filled in
- [ ] Database migrations pushed (`npm run db:push`)
- [ ] Types generated (`npm run gen:types`)
