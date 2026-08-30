import { NextRequest, NextResponse } from "next/server";
import { verifyJWT } from "@repo/auth-utils/jwt";
import { getUserByUniqueID } from "@repo/db/index";

const JWT_SECRET = process.env.JWT_SECRET;

export async function GET(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  try {
    const payload = await verifyJWT(token, JWT_SECRET as string);
    if (!payload) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const user = await getUserByUniqueID(payload.userId);
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ name: user.name }, { status: 200 });
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
}
