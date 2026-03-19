/**
 * UniLearn Signup Worker
 * Cloudflare Worker — deployed as a Pages Function at /functions/api/signup.js
 *
 * Env vars to set in Cloudflare Pages → Settings → Environment Variables:
 *   SUPABASE_URL          https://twhajohjcrlxqlvbvddi.supabase.co
 *   SUPABASE_SERVICE_KEY  <service_role key from Supabase → Settings → API>
 *   RESEND_API_KEY        re_xxxxxxxxxxxx
 *   RESEND_FROM           UniLearn <onboarding@yourdomain.pages.dev>
 *   SITE_URL              https://yourdomain.pages.dev
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── CORS headers ──
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const {
      firstName, lastName, email, phone, password,
      schoolName, schoolType, students,
      plan, planName, planTier, planPrice,
      regFileBase64, regFileExt,
    } = body;

    // ── 1. Upload registration doc to Supabase Storage ──
    let regFileUrl = null;
    if (regFileBase64 && regFileExt) {
      const binary  = atob(regFileBase64);
      const bytes   = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const fileName    = `${Date.now()}_${schoolName.replace(/\s+/g, '_')}.${regFileExt}`;
      const uploadRes   = await fetch(
        `${env.SUPABASE_URL}/storage/v1/object/registration-docs/${fileName}`,
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type':  `application/${regFileExt === 'pdf' ? 'pdf' : 'octet-stream'}`,
            'Cache-Control': '3600',
          },
          body: bytes,
        }
      );
      if (uploadRes.ok) {
        regFileUrl = `${env.SUPABASE_URL}/storage/v1/object/public/registration-docs/${fileName}`;
      } else {
        console.warn('Storage upload failed:', await uploadRes.text());
      }
    }

    // ── 2. Create Supabase Auth user (service role bypasses email confirmation) ──
    const authRes  = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,          // mark as confirmed — no Supabase email sent
        user_metadata: {
          full_name:   `${firstName} ${lastName}`,
          school_name: schoolName,
          role:        'school_admin',
        },
      }),
    });

    const authData = await authRes.json();

    if (!authRes.ok) {
      const msg = authData?.msg || authData?.message || 'Auth error';
      if (/already registered|already exists/i.test(msg)) {
        return Response.json(
          { error: 'An account with this email already exists. Try logging in instead.' },
          { status: 409, headers: cors }
        );
      }
      return Response.json({ error: msg }, { status: 400, headers: cors });
    }

    const userId = authData.id;

    // ── 3. Insert into school_signups ──
    const dbRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/school_signups`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({
          school_name:   schoolName,
          admin_name:    `${firstName} ${lastName}`,
          email,
          phone,
          school_type:   schoolType,
          student_count: students,
          plan:          planName,
          plan_tier:     planTier,
          reg_doc_url:   regFileUrl,
          auth_user_id:  userId,
          created_at:    new Date().toISOString(),
        }),
      }
    );

    if (!dbRes.ok) {
      const dbErr = await dbRes.json().catch(() => ({}));
      console.warn('DB insert failed (non-fatal):', JSON.stringify(dbErr));
      // 23505 = unique email violation — surface this
      if (dbErr?.code === '23505') {
        return Response.json(
          { error: 'An account with this email already exists.' },
          { status: 409, headers: cors }
        );
      }
      // Other DB errors are non-fatal — still send the welcome email
    }

    // ── 4. Send welcome email via Resend ──
    const emailRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    env.RESEND_FROM || 'UniLearn <onboarding@resend.dev>',
        to:      [email],
        subject: `Welcome to UniLearn, ${firstName}! Your trial has started 🎉`,
        html:    buildWelcomeEmail({ firstName, schoolName, planName, planPrice, siteUrl: env.SITE_URL }),
      }),
    });

    if (!emailRes.ok) {
      console.warn('Resend failed:', await emailRes.text());
      // Non-fatal — signup still succeeds
    }

    return Response.json({ ok: true }, { headers: cors });

  } catch (err) {
    console.error('Worker error:', err);
    return Response.json(
      { error: 'Internal server error. Please try again.' },
      { status: 500, headers: cors }
    );
  }
}

// Handle OPTIONS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// ── Email template ──
function buildWelcomeEmail({ firstName, schoolName, planName, planPrice, siteUrl }) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; padding:0; background:#f2fbfa; font-family:'Helvetica Neue',Arial,sans-serif; }
  .wrap { max-width:560px; margin:40px auto; background:white; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(47,183,170,.1); }
  .header { background:linear-gradient(135deg,#2fb7aa,#1da99d); padding:40px 48px 36px; text-align:center; }
  .header .logo { font-size:26px; font-weight:800; color:white; letter-spacing:-1px; }
  .header .tagline { color:rgba(255,255,255,.75); font-size:14px; margin-top:4px; }
  .body { padding:40px 48px; }
  h1 { font-size:22px; font-weight:700; color:#0a1628; margin:0 0 12px; }
  p { font-size:15px; color:#475569; line-height:1.65; margin:0 0 16px; }
  .plan-box { background:#f2fbfa; border:1.5px solid #a8e8e3; border-radius:12px; padding:18px 22px; margin:24px 0; }
  .plan-box .plan-name { font-size:18px; font-weight:700; color:#0a1628; }
  .plan-box .plan-detail { font-size:13px; color:#64748b; margin-top:4px; }
  .steps { margin:24px 0; }
  .step { display:flex; align-items:flex-start; gap:14px; margin-bottom:16px; }
  .step-num { width:28px; height:28px; border-radius:50%; background:#2fb7aa; color:white; font-size:13px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px; }
  .step-text { font-size:14px; color:#334155; line-height:1.5; }
  .step-text strong { color:#0a1628; display:block; margin-bottom:2px; }
  .cta { display:block; text-align:center; background:#2fb7aa; color:white; font-size:15px; font-weight:700; padding:15px 32px; border-radius:10px; text-decoration:none; margin:28px 0 8px; }
  .footer { background:#f8fffe; border-top:1px solid #e4f9f7; padding:24px 48px; text-align:center; font-size:12px; color:#94a3b8; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">UniLearn</div>
    <div class="tagline">Modern infrastructure for education</div>
  </div>
  <div class="body">
    <h1>Welcome, ${firstName}! 🎉</h1>
    <p>Your 30-day free trial for <strong>${schoolName}</strong> is now active. We're verifying your registration document and will have your campus ready within 24 hours.</p>

    <div class="plan-box">
      <div class="plan-name">${planName} Plan</div>
      <div class="plan-detail">30 days free · then ${planPrice}/month · cancel anytime</div>
    </div>

    <p><strong style="color:#0a1628">What happens next:</strong></p>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text"><strong>Document verification</strong>Our team reviews your school registration proof — usually under 24 hours.</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text"><strong>Campus activation</strong>You'll get a second email with your login link once verified.</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text"><strong>Invite your staff & students</strong>Start building your campus — teachers, classes, and parents.</div>
      </div>
    </div>

    <a class="cta" href="${siteUrl || 'https://unilearn.pages.dev'}">Go to UniLearn →</a>

    <p style="font-size:13px;color:#94a3b8;text-align:center;margin-top:16px">Questions? Reply to this email — we're here to help.</p>
  </div>
  <div class="footer">
    © ${new Date().getFullYear()} UniLearn · You're receiving this because you signed up at UniLearn.<br>
    <a href="${siteUrl || '#'}" style="color:#2fb7aa;text-decoration:none">Visit site</a>
  </div>
</div>
</body>
</html>`;
}