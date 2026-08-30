import { describe, expect, it } from "vitest";
import { register, queuePushCounter, queueConsumeCounter } from "./index";

describe("metrics registry", () => {
  it("exposes the queue counters in Prometheus text format", async () => {
    queuePushCounter.labels("ORDER_queue").inc();
    queueConsumeCounter.labels("ORDER_queue").inc(2);

    const text = await register.metrics();
    expect(text).toContain("queue_push_total");
    expect(text).toContain("queue_consume_total");
    expect(text).toMatch(/queue_push_total\{queueName="ORDER_queue"\} 1/);
    expect(text).toMatch(/queue_consume_total\{queueName="ORDER_queue"\} 2/);
  });

  it("includes default Node.js process metrics", async () => {
    const text = await register.metrics();
    expect(text).toContain("process_cpu_user_seconds_total");
  });
});
