import { waitUntil } from "@vercel/functions";
import { notify } from "@/lib/telegram";
import { processRun } from "./run";

// Padrão respond-early + waitUntil: cada invocação processa estágios até o soft
// limit, salva estado no Blob e dispara a próxima invocação (que responde 202 na
// hora). Nenhuma função segura a cadeia inteira — cabe em qualquer plano Vercel.

const SOFT_LIMIT_MS = 200_000; // folga real pro pior estágio dentro do maxDuration=300s

export function baseUrl(): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function processAndChain(runId: string): Promise<void> {
  const run = await processRun(runId, Date.now() + SOFT_LIMIT_MS);
  if (run && run.stage !== "done" && run.stage !== "error") {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-run-secret": process.env.CRON_SECRET ?? "",
    };
    // deployment protection da Vercel bloquearia o fetch server-to-server sem isto
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
    // o elo mais frágil do sistema é este POST — se ele falha, o run congela
    // até watchdog/chute manual. 3 tentativas antes de desistir.
    let chained = false;
    for (let i = 0; i < 3 && !chained; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 2500 * i));
      try {
        const res = await fetch(`${baseUrl()}/api/run/continue`, {
          method: "POST",
          headers,
          body: JSON.stringify({ runId }),
        });
        if (res.ok) chained = true;
      } catch {
        // tenta de novo
      }
    }
    if (!chained) {
      await notify(`⚠️ motor X: a cadeia do run ${runId} quebrou (3 tentativas). Retoma pelo dashboard.`);
    }
  }
}

export function kickoff(runId: string): void {
  waitUntil(processAndChain(runId));
}
