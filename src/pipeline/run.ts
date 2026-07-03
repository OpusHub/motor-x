import { AGENTS, ASSETS } from "@/prompts/bundle";
import { describeImage, runAgent, sampleVoiceSeeds } from "@/lib/claude";
import { loadConfig } from "@/lib/config";
import { getJSON, listJSON, putJSON } from "@/lib/store";
import { notify, readInbox } from "@/lib/telegram";
import { nicheTrends, victorRecentTweets } from "@/lib/twitterapi";
import { createPost, personalAccounts, ZernioError } from "@/lib/zernio";
import {
  AppConfig,
  Draft,
  Finalista,
  GatherResult,
  InboxItem,
  Morto,
  Pauta,
  RunState,
  ScheduledPost,
  Selecionado,
} from "@/lib/types";
import { computeSlots, todayBRT } from "./schedule";
import { CRITICO_SCHEMA, DRAFT_SCHEMA, EDITOR_SCHEMA, PAUTAS_SCHEMA } from "./schemas";

const runPath = (id: string) => `runs/${id}.json`;
const postPath = (date: string, pautaId: string) => `posts/${date}/${pautaId}.json`;

export async function loadRun(id: string): Promise<RunState | null> {
  return getJSON<RunState>(runPath(id));
}

async function saveRun(run: RunState): Promise<void> {
  run.updatedAt = new Date().toISOString();
  await putJSON(runPath(run.id), run);
}

export async function createRun(opts?: { manual?: boolean; mode?: "auto" | "review" }): Promise<RunState> {
  const config = await loadConfig();
  const date = todayBRT();
  const suffix = opts?.manual
    ? `-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}${Math.random().toString(36).slice(2, 5)}`
    : "";
  const run: RunState = {
    id: `run-${date}${suffix}`,
    date,
    stage: "gather",
    mode: opts?.mode ?? config.mode,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    log: [`run criado (${opts?.manual ? "manual" : "cron"}, mode=${opts?.mode ?? config.mode})`],
  };
  await saveRun(run);
  return run;
}

// Extrai o bloco de um MOV específico do structure-bank (## MOV-XX ... até o próximo ##)
function movBlock(movId: string): string {
  const bank = ASSETS.structureBank;
  const re = new RegExp(`## ${movId}[^\\n]*\\n[\\s\\S]*?(?=\\n## |\\n---|$)`);
  const match = bank.match(re);
  return match ? match[0] : `(${movId} não encontrado — use a estrutura mais próxima do objetivo)`;
}

function recentDates(days: number, from: string): string[] {
  const [y, m, d] = from.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length: days }, (_, i) =>
    new Date(base - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
}

async function stageGather(run: RunState): Promise<void> {
  // 1. drena o Telegram e persiste no inbox durável do dia ANTES de montar os
  //    insumos — retry do run não perde braindump (o getUpdates é destrutivo)
  const telegramTexts = await readInbox();
  const inboxPath = `inbox/${run.date}.json`;
  const raw = (await getJSON<(string | InboxItem)[]>(inboxPath)) ?? [];
  // compat: itens antigos eram strings puras
  let inbox: InboxItem[] = raw.map((it, i) =>
    typeof it === "string" ? { id: `m${i + 1}`, texto: it } : { ...it, id: it.id ?? `m${i + 1}` }
  );
  let inboxDirty = false;
  if (telegramTexts.length > 0) {
    inbox = [...inbox, ...telegramTexts.map((t, i) => ({ id: `tg${inbox.length + i + 1}`, texto: t }))];
    inboxDirty = true;
  }
  // lê os prints anexados que ainda não têm descrição (visão via LLM)
  for (const item of inbox) {
    if (item.mediaUrl && !item.mediaDescricao) {
      const desc = await describeImage(item.mediaUrl);
      if (desc) {
        item.mediaDescricao = desc;
        inboxDirty = true;
      }
    }
  }
  if (inboxDirty) await putJSON(inboxPath, inbox);

  const [trends, anchors, ...postsByDay] = await Promise.all([
    nicheTrends(6),
    victorRecentTweets(6),
    ...recentDates(7, run.date).map((d) => listJSON<ScheduledPost & { texto: string }>(`posts/${d}/`, 20)),
  ]);

  const historico = postsByDay
    .flat()
    .map((p) => p.data)
    .filter((p) => p.texto && p.status !== "killed" && p.status !== "failed")
    .map((p) => p.texto)
    .slice(-30);

  const factsBank = JSON.parse(ASSETS.factsBank) as { facts: { id: string; fato: string; fonte: string }[] };
  const dynamicFacts = (await getJSON<{ facts: { id: string; fato: string; fonte: string }[] }>("facts.json"))?.facts ?? [];

  const voiceAnchors =
    anchors.length >= 3 ? anchors : sampleVoiceSeeds(ASSETS.voiceSamples, 5, `anchors-${run.date}`);

  const insumos: GatherResult = {
    inbox,
    trends,
    facts: [...factsBank.facts, ...dynamicFacts],
    historico,
    voiceAnchors,
  };
  run.insumos = insumos;
  run.log.push(
    `gather: ${insumos.inbox.length} inbox (${insumos.inbox.filter((i) => i.mediaUrl).length} com print), ${trends.length} trends, ${insumos.facts.length} fatos, ${historico.length} históricos, âncoras ${anchors.length >= 3 ? "vivas" : "estáticas"}`
  );
  run.stage = "pautas";
}

async function stagePautas(run: RunState, config: AppConfig): Promise<void> {
  const insumos = run.insumos!;
  const quantidade = Math.min(Math.ceil(config.postsPerDay * 1.6), 10);
  const result = await runAgent<{ pautas: Pauta[] }>({
    agentPrompt: AGENTS.pauteiro,
    stableDocs: [
      { tag: "linha_editorial", content: ASSETS.linhaEditorial },
      { tag: "victor_profile", content: ASSETS.victorProfile },
      { tag: "structure_bank", content: ASSETS.structureBank },
    ],
    dynamicDocs: [
      {
        tag: "inbox",
        content: insumos.inbox.length
          ? insumos.inbox
              .map(
                (it) =>
                  `[${it.id}] ${it.texto}${it.mediaUrl ? `\n(PRINT ANEXADO ${it.id} — o post desta pauta pode sair com esta imagem. O que o print mostra: ${it.mediaDescricao ?? "sem leitura"})` : ""}`
              )
              .join("\n---\n")
          : "(vazio hoje)",
      },
      {
        tag: "trends",
        content: insumos.trends.length
          ? insumos.trends.map((t) => `@${t.autor} (${t.metricas}): ${t.texto}`).join("\n---\n")
          : "(sem trends disponíveis)",
      },
      { tag: "facts_bank", content: insumos.facts.map((f) => `[${f.id}] ${f.fato} (fonte: ${f.fonte})`).join("\n") },
      { tag: "historico_recente", content: insumos.historico.join("\n---\n") || "(nenhum post recente)" },
    ],
    task: {
      data: run.date,
      quantidade_pautas: quantidade,
      posts_do_dia: config.postsPerDay,
      mix_idioma: `~${Math.round(config.ptShare * 100)}% pt / ${Math.round((1 - config.ptShare) * 100)}% en (idioma único por pauta)`,
    },
    schema: PAUTAS_SCHEMA,
    effort: "medium",
    agent: "pauteiro",
    timeoutMs: 160_000, // chamada grande (structure-bank inteiro + 8 pautas de output)
    maxTokens: 30000, // reasoning conta no budget — sem folga o JSON sai truncado
  });
  const tag = run.startedAt.slice(11, 19).replace(/:/g, "");
  run.pautas = result.pautas.map((p, i) => ({ ...p, id: `${tag}p${i + 1}` }));
  run.log.push(`pauteiro: ${result.pautas.length} pautas (${result.pautas.map((p) => p.mov).join(", ")})`);
  run.stage = "drafts";
}

const DRAFTS_BATCH = 4;

function mediaItemOf(run: RunState, pauta: Pauta): InboxItem | undefined {
  if (!pauta.inbox_media_id) return undefined;
  return (run.insumos?.inbox ?? []).find((i) => i.id === pauta.inbox_media_id && i.mediaUrl);
}

async function stageDrafts(run: RunState): Promise<void> {
  // Incremental: processa até DRAFTS_BATCH pautas por invocação e persiste o
  // parcial — o estágio inteiro nunca estoura o teto de tempo da função.
  const done = new Set((run.drafts ?? []).map((d) => d.pautaId));
  const failed = new Set(
    run.log.filter((l) => l.startsWith("draft-falhou:")).map((l) => l.split(":")[1])
  );
  const pending = (run.pautas ?? []).filter((p) => !done.has(p.id) && !failed.has(p.id));
  const batch = pending.slice(0, DRAFTS_BATCH);

  const results = await Promise.allSettled(
    batch.map(async (pauta) => {
      const seeds = sampleVoiceSeeds(ASSETS.voiceSamples, 4, `${run.id}-${pauta.id}`);
      const media = mediaItemOf(run, pauta);
      const out = await runAgent<{ texto: string; seed_descartada: string }>({
        agentPrompt: AGENTS.ghostwriter,
        stableDocs: [
          { tag: "voice_model", content: ASSETS.voiceModel },
          { tag: "victor_profile", content: ASSETS.victorProfile },
        ],
        dynamicDocs: [
          { tag: "voice_seeds", content: seeds.join("\n---\n") },
          { tag: "mov_esqueleto", content: movBlock(pauta.mov) },
          { tag: "pauta", content: JSON.stringify(pauta, null, 2) },
          ...(media
            ? [
                {
                  tag: "print_anexado",
                  content: `Este post SAI com um print anexado. O que o print mostra: ${media.mediaDescricao ?? media.texto}. Regra 5.3 do voice_model: REFERENCIE o que o print mostra ("já somou isso"), NUNCA reescreva no texto os números que a imagem já exibe.`,
                },
              ]
            : []),
        ],
        task: { instrucao: "escreva o tweet desta pauta seguindo o protocolo" },
        schema: DRAFT_SCHEMA,
        effort: "high",
        maxTokens: 12000,
        agent: "ghostwriter",
      });
      return { pautaId: pauta.id, texto: out.texto, seedDescartada: out.seed_descartada } satisfies Draft;
    })
  );

  const newDrafts = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  run.drafts = [...(run.drafts ?? []), ...newDrafts];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      run.log.push(`draft-falhou:${batch[i].id}: ${String(r.reason).slice(0, 120)}`);
    }
  });

  const remaining = pending.length - batch.length;
  run.log.push(`ghostwriter: +${newDrafts.length} drafts (total ${run.drafts.length}, faltam ${remaining})`);
  if (remaining > 0) return; // continua no estágio drafts na próxima passada

  if (run.drafts.length === 0) throw new Error("nenhum draft gerado");
  run.stage = "critico";
}

async function stageCritico(run: RunState): Promise<void> {
  const pautasById = new Map((run.pautas ?? []).map((p) => [p.id, p]));
  const draftsComPauta = (run.drafts ?? []).map((d) => ({
    id: d.pautaId,
    texto: d.texto,
    pauta: pautasById.get(d.pautaId),
  }));

  const result = await runAgent<{ finalistas: Finalista[]; mortos: Morto[] }>({
    agentPrompt: AGENTS.critico,
    stableDocs: [
      { tag: "voice_model", content: ASSETS.voiceModel },
      { tag: "victor_profile", content: ASSETS.victorProfile },
      { tag: "algorithm_rules", content: ASSETS.algorithmRules },
    ],
    dynamicDocs: [
      { tag: "anchors", content: (run.insumos?.voiceAnchors ?? []).join("\n---\n") },
      { tag: "drafts", content: JSON.stringify(draftsComPauta, null, 2) },
    ],
    task: { instrucao: "rode as fases A, B e C no lote inteiro" },
    schema: CRITICO_SCHEMA,
    effort: "high",
    maxTokens: 20000,
    agent: "critico",
    timeoutMs: 220_000, // 1 chamada grande julgando o lote inteiro — precisa de folga
  });

  run.finalistas = result.finalistas;
  run.mortos = result.mortos;
  run.log.push(
    `crítico: ${result.finalistas.length} finalistas (scores ${result.finalistas.map((f) => f.score).join(", ")}), ${result.mortos.length} mortos`
  );
  if (result.finalistas.length === 0) throw new Error("crítico matou todos os drafts");
  run.stage = "editor";
}

async function stageEditor(run: RunState, config: AppConfig): Promise<void> {
  const pautasById = new Map((run.pautas ?? []).map((p) => [p.id, p]));
  const finalistasComPauta = (run.finalistas ?? []).map((f) => {
    const pauta = pautasById.get(f.id);
    return {
      ...f,
      pilar: pauta?.pilar,
      objetivo: pauta?.objetivo,
      idioma: pauta?.idioma,
      tem_print_anexado: !!(pauta && mediaItemOf(run, pauta)),
    };
  });

  const result = await runAgent<{ selecionados: Selecionado[]; descartados: Morto[] }>({
    agentPrompt: AGENTS.editor,
    stableDocs: [{ tag: "linha_editorial", content: ASSETS.linhaEditorial }],
    dynamicDocs: [
      { tag: "finalistas", content: JSON.stringify(finalistasComPauta, null, 2) },
      { tag: "agenda", content: (run.insumos?.historico ?? []).slice(-8).join("\n---\n") || "(vazia)" },
    ],
    task: { posts_do_dia: config.postsPerDay, data: run.date },
    schema: EDITOR_SCHEMA,
    effort: "low",
    maxTokens: 8000,
    agent: "editor",
  });

  run.selecionados = result.selecionados.slice(0, config.postsPerDay);
  run.log.push(`editor: ${run.selecionados.length} selecionados, ${result.descartados.length} descartados`);
  for (const d of result.descartados) run.log.push(`editor-descartou ${d.id}: ${d.motivo.slice(0, 100)}`);
  if (run.selecionados.length === 0) throw new Error("editor não selecionou nenhum post");
  run.stage = "agendar";
}

async function stageAgendar(run: RunState, config: AppConfig): Promise<void> {
  const slots = computeSlots(run.date, run.selecionados ?? [], config);
  const finalistasById = new Map((run.finalistas ?? []).map((f) => [f.id, f]));

  // conta conectada: config manda; senão detecta na Zernio
  let accountId = config.channels.x.accountId;
  if (!accountId) {
    try {
      accountId = (await personalAccounts()).twitter?._id;
    } catch {
      accountId = undefined;
    }
  }
  const asDraft = run.mode === "review" || !config.channels.x.enabled || !accountId;

  const scheduled: ScheduledPost[] = [];
  for (const sel of run.selecionados ?? []) {
    const finalista = finalistasById.get(sel.id);
    if (!finalista) continue;

    // idempotência: retry do estágio não recria post que já entrou na Zernio
    const existing = await getJSON<ScheduledPost & { runId?: string }>(postPath(run.date, sel.id));
    if (existing?.zernioPostId && existing.runId === run.id) {
      scheduled.push(existing);
      continue;
    }

    const scheduledForISO = slots.get(sel.id) ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const pautaSel = (run.pautas ?? []).find((p) => p.id === sel.id);
    const mediaUrl = pautaSel ? mediaItemOf(run, pautaSel)?.mediaUrl : undefined;
    const post: ScheduledPost = {
      pautaId: sel.id,
      texto: finalista.texto,
      platform: "twitter",
      scheduledForISO,
      status: asDraft ? "draft" : "scheduled",
      mediaUrl,
    };
    try {
      const result = await createPost({
        content: finalista.texto,
        platform: "twitter",
        accountId,
        scheduledForISO: asDraft ? undefined : scheduledForISO,
        isDraft: asDraft,
        idempotencyKey: `${run.id}-${sel.id}`,
        mediaUrl,
      });
      post.zernioPostId = result.post._id;
    } catch (err) {
      if (err instanceof ZernioError && err.status === 409) {
        // duplicata (dedup de conteúdo da Zernio) — o post JÁ existe lá
        const match = err.body.match(/"existingPostId"\s*:\s*"([^"]+)"/);
        if (match) post.zernioPostId = match[1];
        post.erro = "409: post já existia na Zernio (dedup)";
      } else {
        post.status = "failed";
        post.erro = err instanceof Error ? err.message.slice(0, 300) : String(err);
      }
    }
    scheduled.push(post);
    try {
      await putJSON(postPath(run.date, sel.id), { ...post, runId: run.id, score: finalista.score });
    } catch {
      run.log.push(`aviso: falha ao gravar registro do post ${sel.id} no Blob (post existe na Zernio: ${post.zernioPostId ?? "-"})`);
    }
  }

  run.scheduled = scheduled;
  run.log.push(
    `agendar: ${scheduled.filter((s) => s.status !== "failed").length}/${scheduled.length} na Zernio (${asDraft ? "DRAFTS — " + (accountId ? "modo review" : "conta X não conectada") : "agendados"})`
  );
  run.stage = "notificar";
}

function fmtHourBRT(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return d.toISOString().slice(11, 16);
}

async function stageNotificar(run: RunState): Promise<void> {
  const posts = run.scheduled ?? [];
  const ok = posts.filter((p) => p.status !== "failed");
  const isDraft = ok.every((p) => p.status === "draft");
  const lines = [
    `🤖 motor X — ${run.date}`,
    isDraft
      ? `${ok.length} posts criados como RASCUNHO na Zernio (conecta a conta X pra publicar):`
      : `${ok.length} posts agendados:`,
    "",
    ...ok.map((p) => `⏰ ${fmtHourBRT(p.scheduledForISO)} BRT\n${p.texto}\n`),
  ];
  if (posts.some((p) => p.status === "failed")) {
    lines.push(`⚠️ ${posts.filter((p) => p.status === "failed").length} falharam — ver dashboard`);
  }
  if (run.mortos?.length) {
    lines.push(`🔪 crítico matou ${run.mortos.length}: ${run.mortos.map((m) => m.motivo).join(" · ")}`);
  }
  await notify(lines.join("\n").slice(0, 4000));
  run.log.push("notificação enviada");
  run.stage = "done";
}

// Executa UM estágio e persiste. Retorna o run atualizado.
export async function advance(run: RunState): Promise<RunState> {
  const config = await loadConfig();
  try {
    switch (run.stage) {
      case "gather":
        await stageGather(run);
        break;
      case "pautas":
        await stagePautas(run, config);
        break;
      case "drafts":
        await stageDrafts(run);
        break;
      case "critico":
        await stageCritico(run);
        break;
      case "editor":
        await stageEditor(run, config);
        break;
      case "agendar":
        await stageAgendar(run, config);
        break;
      case "notificar":
        await stageNotificar(run);
        break;
      default:
        throw new Error(`estágio desconhecido: ${run.stage}`);
    }
  } catch (err) {
    run.failedStage = run.stage === "error" ? run.failedStage : run.stage;
    run.stage = "error";
    run.error = err instanceof Error ? err.message.slice(0, 500) : String(err);
    run.log.push(`ERRO: ${run.error}`);
    await notify(`⚠️ motor X falhou no run ${run.id} (${run.error.slice(0, 200)}). Retoma pelo dashboard.`);
  }
  await saveRun(run);
  return run;
}

// Reativa um run que morreu em erro: volta pro estágio que falhou.
export async function resumeErroredRun(run: RunState): Promise<RunState> {
  if (run.stage === "error" && run.failedStage && run.failedStage !== "error") {
    run.stage = run.failedStage;
    run.error = undefined;
    run.log.push(`retomando do estágio ${run.failedStage}`);
    await saveRun(run);
  }
  return run;
}

// Processa estágios até acabar ou estourar o deadline (soft limit da invocação).
// Lease simples evita dois processadores concorrentes no mesmo run.
export async function processRun(runId: string, deadlineMs: number): Promise<RunState | null> {
  let run = await loadRun(runId);
  if (!run) return null;
  if (run.processingUntil && new Date(run.processingUntil).getTime() > Date.now()) {
    return run; // outro processador segura o lease
  }
  run.processingUntil = new Date(deadlineMs + 30_000).toISOString();
  await saveRun(run);

  while (run.stage !== "done" && run.stage !== "error" && Date.now() < deadlineMs) {
    run = await advance(run);
  }
  run.processingUntil = undefined;
  await saveRun(run);
  return run;
}
