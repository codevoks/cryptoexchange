// Integration test against a real Redis instance. Deliberately does not
// exercise consumeFromQueue() here — it runs an intentional infinite BRPOP
// loop (that's the whole point of a queue consumer), which would hang the
// test process. Instead this verifies the producer side directly against
// the raw list, which is enough to prove pushToQueue's wire format is what
// the engine's consumer expects.
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { createClient } from "redis";
import { pushToQueue } from "./queue";

const hasRedis = Boolean(process.env.REDIS_URL);

describe.skipIf(!hasRedis)("pushToQueue (integration)", () => {
  const client = hasRedis ? createClient({ url: process.env.REDIS_URL }) : null;

  afterAll(async () => {
    await client?.quit();
  });

  it("LPUSHes a JSON-serialized payload onto the named list", async () => {
    await client!.connect();
    const queueName = `test-queue-${randomUUID()}`;
    const payload = { hello: "world", n: 42 };

    await pushToQueue(queueName, payload);

    const raw = await client!.rPop(queueName);
    expect(raw ? JSON.parse(raw) : null).toEqual(payload);
  });
});
