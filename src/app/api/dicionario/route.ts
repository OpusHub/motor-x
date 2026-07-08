import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { Dicionario, loadDicionario, saveDicionario } from "@/lib/dicionario";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await loadDicionario());
}

export async function PUT(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Dicionario | null;
  if (!body || !Array.isArray(body.banidas) || !Array.isArray(body.preferidas)) {
    return NextResponse.json({ error: "formato inválido" }, { status: 400 });
  }
  // valida regexes antes de salvar — regex quebrada não pode ir pro lint
  for (const b of body.banidas) {
    if (b.tipo === "regex") {
      try {
        new RegExp(b.termo, "i");
      } catch {
        return NextResponse.json({ error: `regex inválida: ${b.termo}` }, { status: 400 });
      }
    }
    if (!b.termo?.trim()) return NextResponse.json({ error: "termo vazio" }, { status: 400 });
  }
  await saveDicionario(body);
  return NextResponse.json({ ok: true });
}
