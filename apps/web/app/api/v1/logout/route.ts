import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
    try {
        const cookieStore = await cookies();
        const hasCookie = cookieStore.has("token");
        if (!hasCookie) {
            return NextResponse.json({ message: "Authentication token not found" }, { status: 400 });
        }
        cookieStore.delete("token");
        return NextResponse.json({ message: "Logged out successfully" }, { status: 200 });
    } catch {
        return NextResponse.json({ message: "Failed to log out" }, { status: 400 });
    }
}