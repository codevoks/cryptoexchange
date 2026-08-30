import { NextRequest, NextResponse } from "next/server";
import { logInSchema, JwtPayLoad } from "@repo/types/authTypes";
import { jwtSign } from "@repo/auth-utils/jwt";
import bcrypt from "bcrypt";
import { getUserByEmail } from "@repo/db/index";
import { setAuthCookie } from "@/lib/auth/session";

const JWT_SECRET = process.env.JWT_SECRET;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = logInSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 400 }
      );
    }
    const { email, password } = result.data;
    const user = await getUserByEmail(email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const passwordMatched = await bcrypt.compare(password, user.hashedPassword);
    if (!passwordMatched) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const payload: JwtPayLoad = { userId: user.id, email: user.email };
    const token = await jwtSign(payload, JWT_SECRET as string);
    if (!token) {
      return NextResponse.json(
        { message: "Token could not be created" },
        { status: 500 }
      );
    }

    const response = NextResponse.json(
      { message: "Login successful" },
      { status: 200 }
    );
    setAuthCookie(response, token);
    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { message: "Error in logging in route" },
      { status: 500 }
    );
  }
}
