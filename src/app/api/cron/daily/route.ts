import { NextRequest, NextResponse } from "next/server";
import { isCronAuthed } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { kickoff } from "@/pipeline/chain";
import { createRun, loadRun, resumeErroredRun } from "@/pipeline/run";
import { todayBRT } from "@/pipeline/schedule";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isCronAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const config = await loadConfig();
  if (config.paused) return NextResponse.json({ skipped: "sistema pausado" });

  const today = todayBRT();
  const existing = await loadRun(`run-${today}`);
  if (existing?.stage === "done") return NextResponse.json({ skipped: `run de ${today} já concluído` });

  // retoma run inacabado ou em erro (nunca recria por cima — evita post duplicado)
  const run = existing ? await resumeErroredRun(existing) : await createRun();

  kickoff(run.id);
  return NextResponse.json({ started: run.id, stage: run.stage }, { status: 202 });
}
