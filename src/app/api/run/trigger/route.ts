import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { kickoff } from "@/pipeline/chain";
import { createRun } from "@/pipeline/run";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// "Gerar agora" do dashboard. mode=review cria só rascunhos na Zernio.
export async function POST(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { mode?: "auto" | "review" };
  const run = await createRun({ manual: true, mode: body.mode });
  kickoff(run.id);
  return NextResponse.json({ started: run.id }, { status: 202 });
}
