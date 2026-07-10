import nodemailer from 'nodemailer';

interface SendMailParams {
  to: string;
  subject: string;
  otp: string;
  html: string;
}

interface SendMailResult {
  success: boolean;
  sentRealEmail: boolean;
  error?: string;
}

export async function sendVerificationEmail({ to, subject, otp, html }: SendMailParams): Promise<SendMailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;

  // 1. Resend API Flow (Ideal for cloud hosting/Vercel)
  if (resendApiKey) {
    try {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: process.env.SMTP_FROM || 'NaviGuard Security <onboarding@resend.dev>',
          to: [to],
          subject,
          html,
        }),
      });

      if (!emailResponse.ok) {
        const errData = await emailResponse.json();
        throw new Error(errData.message || 'Failed to dispatch email via Resend');
      }

      return { success: true, sentRealEmail: true };
    } catch (err: any) {
      console.error('[MAIL] Resend dispatch failed, falling back to SMTP checks:', err);
    }
  }

  // 2. SMTP Flow (Ideal for VPS, Docker, Standalone servers, CPanels)
  if (smtpHost) {
    try {
      const port = Number(process.env.SMTP_PORT || 587);
      const secure = port === 465;

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"NaviGuard Security" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html,
      });

      return { success: true, sentRealEmail: true };
    } catch (err: any) {
      console.error('[MAIL] SMTP dispatch failed:', err);
      return { success: false, sentRealEmail: false, error: err.message };
    }
  }

  // 3. Fallback: Log to console in UAT/dev environment
  console.log('\n=============================================================');
  console.log(`[MAIL-FALLBACK-OTP] Code for ${to} is: ${otp}`);
  console.log('=============================================================\n');

  return { success: true, sentRealEmail: false };
}
