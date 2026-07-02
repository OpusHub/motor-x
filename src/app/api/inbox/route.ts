import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { getJSON, putJSON } from "@/lib/store";
import { todayBRT } from "@/pipeline/schedule";

export const dynamic = "force-dynamic";

// Inbox de ideias do dashboard — o pauteiro lê no próximo run.
export async function POST(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { texto } = (await req.json().catch(() => ({}))) as { texto?: string };
  if (!texto?.trim()) return NextResponse.json({ error: "texto obrigatório" }, { status: 400 });

  const date = todayBRT();
  const path = `inbox/${date}.json`;
  const current = (await getJSON<string[]>(path)) ?? [];
  current.push(texto.trim());
  await putJSON(path, current);
  return NextResponse.json({ ok: true, count: current.length });
}

export async function GET(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const date = req.nextUrl.searchParams.get("date") ?? todayBRT();
  const items = (await getJSON<string[]>(`inbox/${date}.json`)) ?? [];
  return NextResponse.json({ date, items });
}
