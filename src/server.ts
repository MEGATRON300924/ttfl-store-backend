import { createApp } from "@/app";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { startEmailWorker } from "@/lib/email-queue";
import { startMaxEventOutboxWorker } from "@/lib/max-event-outbox";
import { startProductAlertWorker } from "@/modules/products/product-alert-worker";
import { startLaunchCampaignWorker } from "@/modules/launch-campaigns/launch-campaign-worker";
import { startSubscriptionWorker } from "@/modules/subscriptions/subscription-worker";

const app = createApp();

app.listen(env.port, () => {
  logger.info(`TTFL Store backend listening on port ${env.port} [${env.nodeEnv}]`);
  startEmailWorker();
  startMaxEventOutboxWorker();
  startProductAlertWorker();
  startLaunchCampaignWorker();
  startSubscriptionWorker();
});
