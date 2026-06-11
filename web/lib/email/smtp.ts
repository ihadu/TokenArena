import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

let cachedTransport: Transporter | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveSmtpConfig() {
  const port = Number(process.env.SMTP_PORT ?? 465);
  const secure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === "true"
      : port === 465;
  return {
    host: requireEnv("SMTP_HOST"),
    port,
    secure,
    auth: { user: requireEnv("SMTP_USER"), pass: requireEnv("SMTP_PASSWORD") },
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
    from: requireEnv("SMTP_FROM"),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
