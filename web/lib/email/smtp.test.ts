import { afterEach, describe, expect, it, vi } from "vitest";

const { createTransportMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(() => ({ sendMail: vi.fn() })),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.SMTP_FROM;
});

describe("getSmtpTransport", () => {
  it("defaults to port 465 with secure=true when SMTP_SECURE is unset", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    const { getSmtpTransport } = await import("./smtp");
    getSmtpTransport();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  it("uses secure=false for port 587 by default", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    process.env.SMTP_PORT = "587";
    const { getSmtpTransport } = await import("./smtp");
    getSmtpTransport();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it("respects explicit SMTP_SECURE override", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "true";
    const { getSmtpTransport } = await import("./smtp");
    getSmtpTransport();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: true }),
    );
  });

  it("caches the transport across calls", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    const { getSmtpTransport } = await import("./smtp");
    getSmtpTransport();
    getSmtpTransport();
    expect(createTransportMock).toHaveBeenCalledTimes(1);
  });
});
