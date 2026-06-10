import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  habits: {
    hourHistogram: number[];
    weekdayHistogram: number[];
    currentStreak: number;
    longestStreak: number;
    deviceCount: number;
  };
};

export function AdminHabitsCard({ habits }: Props) {
  const maxHour = Math.max(...habits.hourHistogram, 1);
  const maxWeekday = Math.max(...habits.weekdayHistogram, 1);

  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">使用习惯</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-2xl font-semibold tabular-nums">{habits.currentStreak}</div>
            <div className="text-xs text-muted-foreground">当前 streak</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{habits.longestStreak}</div>
            <div className="text-xs text-muted-foreground">最长 streak</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{habits.deviceCount}</div>
            <div className="text-xs text-muted-foreground">设备数</div>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">活跃时段（24h）</div>
          <div className="flex h-16 items-end gap-0.5">
            {habits.hourHistogram.map((v, i) => (
              <div
                key={i}
                title={`${i}:00 - ${v}`}
                className="flex-1 bg-amber-500/60"
                style={{ height: `${(v / maxHour) * 100}%` }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">周中分布</div>
          <div className="flex h-12 items-end gap-1">
            {["日", "一", "二", "三", "四", "五", "六"].map((label, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-amber-500/60"
                  style={{ height: `${(habits.weekdayHistogram[i] ?? 0 / maxWeekday) * 100}%` }}
                />
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
