import { describe, expect, it } from "vitest";
import { hashPassword, comparePasswords } from "./password";

describe("hashPassword / comparePasswords", () => {
  it("produces a hash that verifies against the original password", async () => {
    const hash = await hashPassword("correct horse battery staple", 4);
    expect(await comparePasswords("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple", 4);
    expect(await comparePasswords("wrong password", hash)).toBe(false);
  });

  it("never stores the password in plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple", 4);
    expect(hash).not.toContain("correct horse battery staple");
  });
});
