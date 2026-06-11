import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

type Props = {
  t: Translator;
  habits: {
    hourHistogram: number[];
    weekdayHistogram: number[];
    currentStreak: number;
    longestStreak: number;
    deviceCount: number;
  };
};

const HOUR_TICKS = [0, 6, 12, 18, 23] as const;
const WEEKDAY_KEYS = [
  "weekdayShortSun",
  "weekdayShortMon",
  "weekdayShortTue",
  "weekdayShortWed",
  "weekdayShortThu",
  "weekdayShortFri",
  "weekdayShortSat",
] as const;

function peakHourIndex(arr: number[]): number {
  let bestIdx = 0;
  let bestVal = -1;
  for (let i = 0; i < arr.length; i += 1) {
    const v = arr[i] ?? 0;
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function AdminHabitsCard({ t, habits }: Props) {
  const hour = habits.hourHistogram;
  const weekday = habits.weekdayHistogram;
  const hourMax = Math.max(...hour, 1);
  const weekdayMax = Math.max(...weekday, 1);
  const hourTotal = hour.reduce((s, v) => s + v, 0);
  const weekdayTotal = weekday.reduce((s, v) => s + v, 0);
  const peakIdx = peakHourIndex(hour);
  const peakValue = hour[peakIdx] ?? 0;

  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("habits")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {habits.currentStreak}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("currentStreak")}
            </div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {habits.longestStreak}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("longestStreak")}
            </div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {habits.deviceCount}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("deviceCount")}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="text-sm font-medium">{t("hourHistogram")}</div>
            {hourTotal > 0 && peakValue > 0 ? (
              <div className="text-[10px] tabular-nums text-amber-700 dark:text-amber-300">
                {t("peakHour", {
                  hour: `${String(peakIdx).padStart(2, "0")}:00`,
                })}
                <span className="text-muted-foreground ml-1">
                  ({peakValue})
                </span>
              </div>
            ) : null}
          </div>
          {hourTotal === 0 ? (
            <div className="h-16 flex items-center justify-center text-xs text-muted-foreground">
              {t("noActivity")}
            </div>
          ) : (
            <div>
              <div className="flex h-16 items-end gap-0.5">
                {hour.map((v, i) => {
                  const ratio = v / hourMax;
                  const isPeak = i === peakIdx && v > 0;
                  return (
                    <div
                      key={i}
                      title={`${String(i).padStart(2, "0")}:00 — ${v}`}
                      className={`flex-1 min-h-[3px] rounded-sm ${
                        isPeak
                          ? "bg-amber-500 ring-1 ring-amber-600"
                          : "bg-amber-500/60"
                      }`}
                      style={{ height: `${Math.max(ratio * 100, 2)}%` }}
                    />
                  );
                })}
              </div>
              <div className="relative mt-1 h-3">
                {HOUR_TICKS.map((tick) => {
                  const leftPct = (tick / 23) * 100;
                  const isFirst = tick === 0;
                  const isLast = tick === HOUR_TICKS[HOUR_TICKS.length - 1];
                  return (
                    <span
                      key={tick}
                      className="absolute text-[10px] text-muted-foreground tabular-nums"
                      style={{
                        left: `${leftPct}%`,
                        transform: isFirst
                          ? "none"
                          : isLast
                            ? "translateX(-100%)"
                            : "translateX(-50%)",
                      }}
                    >
                      {String(tick).padStart(2, "0")}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-medium mb-1.5">
            {t("weekdayDistribution")}
          </div>
          {weekdayTotal === 0 ? (
            <div className="h-12 flex items-center justify-center text-xs text-muted-foreground">
              {t("noActivity")}
            </div>
          ) : (
            <div className="flex h-12 items-end gap-1">
              {WEEKDAY_KEYS.map((key, i) => {
                const v = weekday[i] ?? 0;
                const ratio = v / weekdayMax;
                return (
                  <div
                    key={key}
                    className="flex-1 flex flex-col items-center gap-1"
                    title={`${t(key)} — ${v}`}
                  >
                    <div
                      className="w-full min-h-[3px] rounded-sm bg-amber-500/60"
                      style={{ height: `${Math.max(ratio * 100, 2)}%` }}
                    />
                    <div className="text-[10px] text-muted-foreground">
                      {t(key)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
