import { NextRequest, NextResponse } from "next/server";
import { RegisterSchema, JwtPayLoad } from "@repo/types/authTypes";
import { jwtSign } from "@repo/auth-utils/jwt";
import bcrypt from "bcrypt";
import { createUser, getUserByEmail, seedDemoBalances } from "@repo/db/index";
import { setAuthCookie } from "@/lib/auth/session";

const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 10;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = RegisterSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid name, email, or password" },
        { status: 400 }
      );
    }
    const { name, email, password } = result.data;
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { message: "User already exists" },
        { status: 409 }
      );
    }
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(name, email, hashedPassword);
    // Demo-only: grant starting funds so the exchange is usable immediately
    // after registering, since there's no deposit flow.
    await seedDemoBalances(user.id);

    const payload: JwtPayLoad = { userId: user.id, email: user.email };
    const token = await jwtSign(payload, JWT_SECRET as string);
    if (!token) {
      return NextResponse.json(
        { message: "Token could not be created" },
        { status: 500 }
      );
    }

    const response = NextResponse.json(
      { message: "Registration successful" },
      { status: 200 }
    );
    setAuthCookie(response, token);
    return response;
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { message: "Error in registering user" },
      { status: 500 }
    );
  }
}
