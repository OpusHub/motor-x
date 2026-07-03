// Imprime o estado do run do dia (lê direto do Blob). Uso: bun run scripts/run-status.ts
import { loadRun } from "../src/pipeline/run";
import { todayBRT } from "../src/pipeline/schedule";

const run = await loadRun(`run-${todayBRT()}`);
if (!run) {
  console.log("sem run hoje");
} else {
  console.log(`stage=${run.stage}${run.error ? ` erro=${run.error}` : ""}`);
  console.log(run.log.slice(-4).join("\n"));
  for (const p of run.scheduled ?? []) {
    const brt = new Date(new Date(p.scheduledForISO).getTime() - 3 * 3600 * 1000)
      .toISOString()
      .slice(11, 16);
    console.log(`[${p.status}] ${brt} BRT :: ${p.texto.slice(0, 90).replace(/\n/g, " / ")}`);
  }
}
