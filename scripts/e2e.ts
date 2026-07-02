// Teste E2E local: roda o pipeline inteiro em modo REVIEW (só cria rascunhos na
// Zernio, nunca publica). Uso: bun run scripts/e2e.ts
// Requer .env.local com ANTHROPIC_API_KEY, ZERNIO_API_KEY, BLOB_READ_WRITE_TOKEN etc.

import { advance, createRun } from "../src/pipeline/run";

async function main() {
  console.log("criando run de teste (mode=review)...");
  let run = await createRun({ manual: true, mode: "review" });
  console.log(`run ${run.id}`);

  while (run.stage !== "done" && run.stage !== "error") {
    const stage = run.stage;
    const t0 = Date.now();
    run = await advance(run);
    console.log(`[${stage} -> ${run.stage}] ${((Date.now() - t0) / 1000).toFixed(1)}s :: ${run.log.at(-1)}`);
  }

  console.log("\n=== RESULTADO ===");
  console.log(run.log.join("\n"));
  if (run.stage === "error") {
    console.error(`\nERRO: ${run.error}`);
    process.exit(1);
  }
  for (const p of run.scheduled ?? []) {
    console.log(`\n[${p.status}] ${p.scheduledForISO} (zernio: ${p.zernioPostId ?? "-"})\n${p.texto}`);
  }
}

main();
