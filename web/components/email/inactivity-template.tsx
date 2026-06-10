type Params = {
  username: string;
  inactiveDays: number;
  lastActiveAt: Date | null;
  subject: string;
  locale: string;
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c] ?? c;
  });
}

export function renderInactivityEmailTemplate(p: Params): string {
  const user = escapeHtml(p.username);
  const subj = escapeHtml(p.subject);
  const isZh = p.locale.startsWith("zh");

  const title = isZh
    ? "好久没看到你的数据了"
    : "We haven't seen your data in a while";
  const body = isZh
    ? `Hi ${user}，<br />已经 <strong>${p.inactiveDays}</strong> 个工作日没收到你的 Token Arena 上传数据了。`
    : `Hi ${user},<br />It's been <strong>${p.inactiveDays}</strong> business days since your last Token Arena upload.`;
  const cta = isZh ? "立刻上传数据 →" : "Upload your data →";
  const footer = isZh
    ? "如果你最近在休息或出门，这封邮件可以忽略。"
    : "If you're on a break, feel free to ignore this.";

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${subj}</title></head>
<body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
<h1 style="font-size: 20px; margin-bottom: 16px;">${title}</h1>
<p>${body}</p>
<p><a href="${process.env.BETTER_AUTH_URL ?? "https://tokenarena.app"}/usage" style="display: inline-block; padding: 10px 16px; background: #1f2937; color: #fff; text-decoration: none; border-radius: 6px;">${cta}</a></p>
<p style="color: #6b7280; font-size: 13px;">${footer}</p>
</body></html>`;
}
