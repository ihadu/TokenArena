import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

let cachedTransport: Transporter | null = null;

function resolveSmtpConfig() {
  const port = Number(process.env.SMTP_PORT ?? 465);
  const secure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === "true"
      : port === 465;
  return {
    host: process.env.SMTP_HOST!,
    port,
    secure,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
  };
}

export function getSmtpTransport(): Transporter {
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport(resolveSmtpConfig());
  }
  return cachedTransport;
}

export async function sendInactivityReminder(opts: {
  to: string;
  subject: string;
  html: string;
}) {
  return getSmtpTransport().sendMail({
    from: process.env.SMTP_FROM!,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
