import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { getJSON, putJSON } from "@/lib/store";

export const dynamic = "force-dynamic";

interface Fato {
  id: string;
  fato: string;
  fonte: string;
}

// Banco de fatos dinâmico (facts.json no Blob) — o combustível que o Victor
// abastece pelo painel. O gather soma isso ao banco fixo do bundle.
export async function GET(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const blob = (await getJSON<{ facts: Fato[] }>("facts.json")) ?? { facts: [] };
  return NextResponse.json(blob);
}

export async function PUT(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { facts?: Fato[] } | null;
  if (!body || !Array.isArray(body.facts)) return NextResponse.json({ error: "formato inválido" }, { status: 400 });
  for (const f of body.facts) {
    if (!f.fato?.trim()) return NextResponse.json({ error: "fato vazio" }, { status: 400 });
    if (!f.id) f.id = `f${Math.random().toString(36).slice(2, 8)}`;
    f.fonte = f.fonte?.trim() || "Victor (painel)";
  }
  await putJSON("facts.json", { facts: body.facts });
  return NextResponse.json({ ok: true, total: body.facts.length });
}
