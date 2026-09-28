import { activateDue } from "./launch-campaigns.service";

const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;
let started = false;

export function startLaunchCampaignWorker() {
  if (started) return;
  started = true;
  const run = () => {
    void activateDue().catch((error) => console.error("Launch campaign worker failed", error));
  };
  run();
  setInterval(run, MAINTENANCE_INTERVAL_MS).unref();
}
