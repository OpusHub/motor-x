import { NextRequest, NextResponse } from "next/server";
import { isCronAuthed } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { listJSON } from "@/lib/store";
import { kickoff } from "@/pipeline/chain";
import { createRun, resumeErroredRun } from "@/pipeline/run";
import { RunState } from "@/lib/types";
import { todayBRT } from "@/pipeline/schedule";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Watchdog: roda a cada 20min o dia inteiro (viável no plano Pro — no Hobby só
// dava 1x/dia, e foi exatamente essa lacuna que deixou um run travado sem
// post até resgate manual em 10/jul). Verifica TODOS os runs de HOJE (cron E
// manuais, que têm sufixo no id) parados em "error", retoma cada um sozinho.
// Se não existe NENHUM run ainda e já passou da janela do cron diário, cria.
export async function GET(req: NextRequest) {
  if (!isCronAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const config = await loadConfig();
  if (config.paused) return NextResponse.json({ skipped: "sistema pausado" });

  const today = todayBRT();
  const runs = await listJSON<RunState>(`runs/run-${today}`, 20);

  // 2 tipos de travamento: (a) erro explícito registrado, (b) travamento
  // SILENCIOSO — a função morreu no meio (ex: estourou maxDuration=300s antes
  // de salvar o erro) e o run ficou parado num estágio não-terminal sem
  // nenhum log novo há mais de 18min (folga sobre os 20min de intervalo do
  // próprio watchdog, pra não brigar com um run genuinamente em andamento)
  const STALE_MS = 18 * 60 * 1000;
  const agora = Date.now();
  const travados = runs
    .map((r) => r.data)
    .filter((r) => r.stage !== "done" && r.stage !== "error" && agora - new Date(r.updatedAt).getTime() > STALE_MS);
  const emErro = runs.map((r) => r.data).filter((r) => r.stage === "error");

  if (emErro.length > 0 || travados.length > 0) {
    const retomados = [];
    for (const r of emErro) {
      const resumed = await resumeErroredRun(r);
      kickoff(resumed.id);
      retomados.push({ id: resumed.id, stage: resumed.stage, tipo: "error" });
    }
    for (const r of travados) {
      kickoff(r.id); // sem erro registrado — só falta empurrar a corrente de novo do estágio salvo
      retomados.push({ id: r.id, stage: r.stage, tipo: "silencioso" });
    }
    return NextResponse.json({ watchdog: "retomou runs travados", retomados }, { status: 202 });
  }

  const algumConcluido = runs.some((r) => r.data.stage === "done");
  if (algumConcluido) return NextResponse.json({ ok: "run do dia já concluído" });
  if (runs.length > 0) return NextResponse.json({ ok: "run do dia em andamento, nada travado" });

  // sem nenhum run hoje: só cria se já passou da janela do cron diário
  // (evita criar run duplicado nos primeiros minutos após as 7:57)
  const horaBRT = (Math.floor(Date.now() / 1000 / 3600) - 3 + 24) % 24;
  if (horaBRT < 8) return NextResponse.json({ skipped: "antes da janela do cron diário" });

  const run = await createRun();
  kickoff(run.id);
  return NextResponse.json({ watchdog: "run do dia nem existia, criado", id: run.id }, { status: 202 });
}
