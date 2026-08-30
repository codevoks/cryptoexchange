import { startQueue } from "./queue-service";
import { cancelOrder } from "../matcher/cancel";

export async function initCancelsQueue(queueName: string) {
  try {
    startQueue(queueName, cancelOrder);
  } catch (error) {
    console.log(" Error while fetching cancel request from queue ", error);
  }
}
