import { describe, expect, it } from "vitest";
import { jwtSign, verifyJWT } from "./jwt";

const SECRET = "test-secret-do-not-use-in-prod";

describe("jwtSign / verifyJWT", () => {
  it("round-trips a payload", async () => {
    const token = await jwtSign({ userId: "user-1", email: "a@b.com" }, SECRET);
    expect(token).not.toBeNull();

    const payload = await verifyJWT(token!, SECRET);
    expect(payload?.userId).toBe("user-1");
    expect(payload?.email).toBe("a@b.com");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await jwtSign({ userId: "user-1", email: "a@b.com" }, SECRET);
    const payload = await verifyJWT(token!, "wrong-secret");
    expect(payload).toBeNull();
  });

  it("rejects a garbage token instead of throwing", async () => {
    const payload = await verifyJWT("not-a-real-jwt", SECRET);
    expect(payload).toBeNull();
  });

  it("sets an expiry in the near future", async () => {
    const token = await jwtSign({ userId: "user-1", email: "a@b.com" }, SECRET);
    const payload = await verifyJWT(token!, SECRET);
    expect(payload?.exp).toBeGreaterThan(Date.now() / 1000);
    expect(payload?.exp).toBeLessThanOrEqual(Date.now() / 1000 + 3600 + 5);
  });
});
