import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed, setPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Troca a senha do dashboard (a nova vale a partir do próximo login).
export async function PUT(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { newPassword } = (await req.json().catch(() => ({}))) as { newPassword?: string };
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "senha precisa de pelo menos 8 caracteres" }, { status: 400 });
  }
  await setPassword(newPassword);
  return NextResponse.json({ ok: true });
}
