import { NextRequest, NextResponse } from "next/server";
import { isCronAuthed, isDashboardAuthed } from "@/lib/auth";
import { kickoff } from "@/pipeline/chain";
import { loadRun, resumeErroredRun } from "@/pipeline/run";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isCronAuthed(req) && !isDashboardAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { runId } = (await req.json().catch(() => ({}))) as { runId?: string };
  if (!runId) return NextResponse.json({ error: "runId obrigatório" }, { status: 400 });

  let run = await loadRun(runId);
  if (!run) return NextResponse.json({ error: "run não encontrado" }, { status: 404 });
  if (run.stage === "done") return NextResponse.json({ done: true });

  // run em "error": volta pro estágio que falhou antes de retomar
  run = await resumeErroredRun(run);
  kickoff(runId);
  return NextResponse.json({ continuing: runId, stage: run.stage }, { status: 202 });
}
