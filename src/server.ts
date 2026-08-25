import { createApp } from "@/app";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { startEmailWorker } from "@/lib/email-queue";

const app = createApp();

app.listen(env.port, () => {
  logger.info(`TTFL Store backend listening on port ${env.port} [${env.nodeEnv}]`);
  startEmailWorker();
});
