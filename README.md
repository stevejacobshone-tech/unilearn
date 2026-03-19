# UniLearn — Setup Guide

## Repo structure

```
/
├── index.html              ← Homepage
├── pricing_plan.html       ← Pricing & onboarding
├── signup.html             ← Multi-step signup (calls /api/signup)
├── login.html              ← Login (Supabase auth)
├── dashboard.html          ← School admin dashboard
├── confirmation.html       ← Post-signup confirmation
├── functions/
│   └── api/
│       └── signup.js       ← Cloudflare Pages Function (Worker)
├── _redirects              ← Cloudflare Pages routing
└── .github/
    └── workflows/
        └── deploy.yml      ← Auto-deploy on push to main
```

---

## 1 · GitHub

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/unilearn.git
git push -u origin main
```

---

## 2 · Cloudflare Pages

1. Go to **Cloudflare Dashboard → Workers & Pages → Create → Pages**
2. Connect your GitHub repo
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/` (root)
4. Click **Save and Deploy**

Your site will be live at `unilearn.pages.dev` (or whatever name you pick).

---

## 3 · Environment Variables

In **Cloudflare Pages → Settings → Environment Variables**, add these for **Production** (and Preview if you want):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://twhajohjcrlxqlvbvddi.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Your **service_role** key from Supabase → Settings → API |
| `RESEND_API_KEY` | Your Resend API key (`re_...`) |
| `RESEND_FROM` | `UniLearn <onboarding@yourdomain.pages.dev>` |
| `SITE_URL` | `https://unilearn.pages.dev` |

> ⚠️ Use the **service_role** key (not anon) for the Worker — it bypasses RLS and can create auth users directly.

---

## 4 · Resend setup

1. Go to [resend.com](https://resend.com) → API Keys → Create key
2. For sending from a `pages.dev` subdomain, use Resend's default **onboarding@resend.dev** address first (works out of the box, no domain verification needed)
3. Later, add your own domain in Resend → Domains and update `RESEND_FROM`

---

## 5 · Supabase — fix the phone unique constraint

The `school_signups` table has a unique constraint on `phone` that causes 409 errors. Run this in your Supabase SQL editor:

```sql
-- Remove the unique constraint on phone (it shouldn't be unique)
ALTER TABLE school_signups DROP CONSTRAINT IF EXISTS school_signups_phone_key;

-- Make sure RLS allows the service_role to insert
-- (service_role bypasses RLS by default, but just in case)
ALTER TABLE school_signups ENABLE ROW LEVEL SECURITY;
```

Also make sure the `registration-docs` storage bucket exists and is public:

```sql
-- Run in Supabase SQL editor if bucket doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('registration-docs', 'registration-docs', true)
ON CONFLICT (id) DO NOTHING;
```

---

## 6 · How signup works now

```
User fills form
    ↓
signup.html  →  POST /api/signup  (Cloudflare Worker)
                    ↓
                1. Upload reg doc → Supabase Storage
                2. Create auth user → Supabase Admin API (email_confirm: true, no email sent)
                3. Insert row → school_signups table
                4. Send welcome email → Resend
                    ↓
              Returns { ok: true }
    ↓
Redirect → confirmation.html
```

The password is set during signup and stored securely in Supabase Auth. No confirmation email from Supabase — Resend handles all transactional email.

---

## 7 · Local dev

Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
npm install -g wrangler
```

Create a `.dev.vars` file (gitignored) for local env vars:

```
SUPABASE_URL=https://twhajohjcrlxqlvbvddi.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
RESEND_API_KEY=re_your_key
RESEND_FROM=UniLearn <onboarding@resend.dev>
SITE_URL=http://localhost:8788
```

Run locally:

```bash
wrangler pages dev . --compatibility-date=2024-01-01
```

Site runs at `http://localhost:8788`.