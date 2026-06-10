export type AdminAnalyticsFixture = {
  dailyAverages: {
    activeDays: number;
    tokens: number;
    cost: number;
    sessions: number;
    activeSeconds: number;
  };
  habits: { currentStreak: number; longestStreak: number; deviceCount: number };
  comparison: {
    vsPrevPeriod: {
      tokens: number;
      cost: number;
      sessions: number;
      activeSeconds: number;
    };
  };
  dailyCosts: number[];
  projectShareShift: number;
  topModel: string;
  topModelPrev: string;
  deviceCountPrev: number;
};

export type Insight = {
  id: string;
  kind:
    | "streak"
    | "inactive"
    | "costSpike"
    | "projectShift"
    | "modelShift"
    | "deviceGrowth";
  severity: "info" | "warn" | "critical";
  title: string;
  body: string;
  hint?: string;
};

function meanStd(values: number[]) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

export function detectInsights(a: AdminAnalyticsFixture): Insight[] {
  const out: Insight[] = [];

  if (a.habits.currentStreak >= 7) {
    out.push({
      id: "streak",
      kind: "streak",
      severity: "info",
      title: "连续打卡",
      body: `已连续 ${a.habits.currentStreak} 天活跃`,
    });
  }

  if (a.habits.currentStreak === 0 && a.dailyAverages.activeDays <= 3) {
    out.push({
      id: "inactive",
      kind: "inactive",
      severity: "warn",
      title: "活跃度低",
      body: `过去 14 天仅 ${a.dailyAverages.activeDays} 天有数据`,
      hint: "建议提醒用户上传数据",
    });
  }

  if (a.dailyAverages.activeDays >= 7 && a.dailyCosts.length >= 7) {
    const { mean, std } = meanStd(a.dailyCosts);
    const max = Math.max(...a.dailyCosts);
    if (max > mean * 2 && std > 0) {
      out.push({
        id: "costSpike",
        kind: "costSpike",
        severity: "critical",
        title: "成本异常高峰",
        body: `单日成本 $${max.toFixed(2)} 超出均值 ${mean.toFixed(2)}`,
      });
    }
  }

  if (a.projectShareShift > 0.3) {
    out.push({
      id: "projectShift",
      kind: "projectShift",
      severity: "info",
      title: "项目占比变化",
      body: `头部项目份额变化 ${(a.projectShareShift * 100).toFixed(0)}pp`,
    });
  }

  if (a.topModel !== a.topModelPrev) {
    out.push({
      id: "modelShift",
      kind: "modelShift",
      severity: "info",
      title: "主导模型变化",
      body: `${a.topModelPrev} → ${a.topModel}`,
    });
  }

  if (a.habits.deviceCount >= 4 && a.deviceCountPrev > 0) {
    const growth =
      (a.habits.deviceCount - a.deviceCountPrev) / a.deviceCountPrev;
    if (growth >= 0.5) {
      out.push({
        id: "deviceGrowth",
        kind: "deviceGrowth",
        severity: "info",
        title: "设备数激增",
        body: `设备数 ${a.deviceCountPrev} → ${a.habits.deviceCount}`,
      });
    }
  }

  return out;
}
