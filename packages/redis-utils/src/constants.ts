export const QUEUE_NAMES = {
  ORDERS: 'ORDER_queue',
  TRADES: 'TRADES_queue',
  CANCELS: 'CANCEL_queue',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];