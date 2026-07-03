import { NextRequest, NextResponse } from "next/server";
import { isCronAuthed } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { kickoff } from "@/pipeline/chain";
import { createRun, loadRun, resumeErroredRun } from "@/pipeline/run";
import { todayBRT } from "@/pipeline/schedule";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Watchdog (10:07 BRT): se o run das 05:57 travou ou nem nasceu, retoma/cria.
// Mesma lógica do cron diário — path separado porque a Vercel chaveia cron por path.
export async function GET(req: NextRequest) {
  if (!isCronAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const config = await loadConfig();
  if (config.paused) return NextResponse.json({ skipped: "sistema pausado" });

  const today = todayBRT();
  const existing = await loadRun(`run-${today}`);
  if (existing?.stage === "done") return NextResponse.json({ ok: "run do dia já concluído" });

  const run = existing ? await resumeErroredRun(existing) : await createRun();
  kickoff(run.id);
  return NextResponse.json({ watchdog: run.id, stage: run.stage }, { status: 202 });
}
