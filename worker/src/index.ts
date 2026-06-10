import cron from "node-cron";
import { runInactivitySweep } from "token-arena-web/lib/email/inactivity-core";

let isRunning = false;

cron.schedule("* * * * *", async () => {
  if (isRunning) {
    console.warn("[inactivity] previous sweep still running, skipping tick");
    return;
  }
  isRunning = true;
  try {
    const result = await runInactivitySweep();
    console.log("[inactivity] sweep", result);
  } catch (err) {
    console.error("[inactivity] sweep failed", err);
  } finally {
    isRunning = false;
  }
});

console.log("[worker] inactivity cron started");
