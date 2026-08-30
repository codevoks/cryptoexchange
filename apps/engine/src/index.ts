import { QUEUE_NAMES } from "@repo/redis-utils/constants";
import { initOrdersQueue } from "./queue/queue-matcher";
import { initTradesQueue } from "./queue/queue-db";
import { initCancelsQueue } from "./queue/queue-cancel";
import { startMetricsServer } from "./metrics/metrics";

async function init() {
  console.log("Starting Matching Engine...");
  await Promise.all([
    initOrdersQueue(QUEUE_NAMES.ORDERS),
    initTradesQueue(QUEUE_NAMES.TRADES),
    initCancelsQueue(QUEUE_NAMES.CANCELS),
  ]);
  startMetricsServer(9101);
}

init();
