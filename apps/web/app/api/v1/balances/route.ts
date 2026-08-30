import { NextResponse } from "next/server";
import { getBalances } from "@repo/db/index";
import { requireUser } from "@/lib/auth/session";

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const balances = await getBalances(user.userId);
  return NextResponse.json({ balances });
}
