import { ASSETS } from "@/prompts/bundle";
import { getPrompt } from "@/lib/overrides";
import { Dicionario, dicionarioDoc, loadDicionario, violacaoDicionario } from "@/lib/dicionario";
import { describeImage, runAgent, sampleVoiceSeeds } from "@/lib/claude";
import { driveSyncSafe } from "@/lib/drive";
import { loadConfig } from "@/lib/config";
import { getJSON, listJSON, putJSON } from "@/lib/store";
import { notify, readInbox } from "@/lib/telegram";
import { nicheTrends, victorRecentTweets } from "@/lib/twitterapi";
import { rssTrends } from "@/lib/rss";
import { redditSignal } from "@/lib/sources/reddit";
import { hnSignal } from "@/lib/sources/hackernews";
import { productHuntSignal } from "@/lib/sources/producthunt";
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
  // 0. puxa transcripts novos da pasta do Drive (dailies) pro inbox de hoje.
  //    Roda ANTES da leitura do inbox pra o material [DAILY] entrar neste run;
  //    driveSyncSafe nunca lança (Drive fora do ar não derruba o dia)
  const drive = await driveSyncSafe(run.date);
  if (drive.novos > 0) run.log.push(`drive: ${drive.novos} transcript(s) de daily no inbox (${drive.nomes.join(", ")})`);

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

  // 1 list() cobrindo todos os dias em vez de 7 (1/dia): list() é "Advanced
  // Operation" no Blob (cota de 2.000/mês no Hobby — estourou em 10/jul com
  // esse padrão). Custo por CHAMADA, não por item, então listar o prefixo
  // largo e filtrar em memória é bem mais barato que 1 chamada por dia.
  const janela = new Set(recentDates(7, run.date));
  const [twitterTrends, anchors, lessonsBlob, todosPosts] = await Promise.all([
    nicheTrends(6),
    victorRecentTweets(6),
    getJSON<{ lessons: { d: string; t: string }[] }>("lessons.json"),
    listJSON<ScheduledPost & { texto: string }>(`posts/`, 500),
  ]);

  const historico = todosPosts
    .filter((p) => janela.has(p.path.split("/")[1] ?? ""))
    .map((p) => p.data)
    .filter((p) => p.texto && p.status !== "killed" && p.status !== "failed")
    .map((p) => p.texto)
    .slice(-30);

  const factsBank = JSON.parse(ASSETS.factsBank) as { facts: { id: string; fato: string; fonte: string }[] };
  const dynamicFacts = (await getJSON<{ facts: { id: string; fato: string; fonte: string }[] }>("facts.json"))?.facts ?? [];

  // fonte externa: X (se twitterapi tiver crédito) → mix grátis Reddit + HN +
  // Product Hunt (3 hosts independentes: um cair não zera o dia) → RSS genérico
  let trends = twitterTrends;
  let trendsFonte = "x";
  if (trends.length === 0) {
    const [reddit, hn, ph] = await Promise.all([
      redditSignal(4, run.date),
      hnSignal(4),
      productHuntSignal(2),
    ]);
    const mix: typeof trends = [];
    for (let i = 0; i < 4; i++) {
      for (const list of [reddit, hn, ph]) if (list[i]) mix.push(list[i]);
    }
    trends = mix.slice(0, 10);
    trendsFonte = `reddit${reddit.length}+hn${hn.length}+ph${ph.length}`;
  }
  if (trends.length === 0) {
    trends = await rssTrends(6);
    trendsFonte = "rss";
  }
  // blindagem do horário do cron (5:57 — reddit/HN às vezes vazios): se tudo
  // falhou, reusa o último trends bom (repetir tema perde pra pauta sem fato
  // externo). Quando há trends novo, persiste pra amanhã.
  if (trends.length > 0) {
    await putJSON("state/last-trends.json", { date: run.date, trends });
  } else {
    const cache = await getJSON<{ date: string; trends: typeof trends }>("state/last-trends.json");
    if (cache?.trends?.length) {
      trends = cache.trends;
      trendsFonte = `cache-${cache.date}`;
    }
  }
  // HN/PH seguram a mesma story por dias e o pauteiro recicla tema (cadence 2
  // dias, browser 4 dias) — trend que quase-iguala post já publicado morre aqui
  const antes = trends.length;
  trends = trends.filter((t) => !historico.some((h) => quaseIgual(t.texto, h)));
  if (trends.length < antes) run.log.push(`gather: ${antes - trends.length} trend(s) filtrado(s) por repetir tema já publicado`);
  if (trends.length === 0) trendsFonte = "nenhuma";

  const voiceAnchors =
    anchors.length >= 3 ? anchors : sampleVoiceSeeds(ASSETS.voiceSamples, 5, `anchors-${run.date}`);

  const lessons = (lessonsBlob?.lessons ?? []).slice(-12).map((l) => l.t);

  const insumos: GatherResult = {
    inbox,
    trends,
    facts: [...factsBank.facts, ...dynamicFacts],
    historico,
    voiceAnchors,
    lessons,
  };
  run.insumos = insumos;
  run.log.push(
    `gather: ${insumos.inbox.length} inbox (${insumos.inbox.filter((i) => i.mediaUrl).length} com print), ${trends.length} trends (${trendsFonte}), ${insumos.facts.length} fatos, ${historico.length} históricos, ${lessons.length} lições, âncoras ${anchors.length >= 3 ? "vivas" : "estáticas"}`
  );
  run.stage = "pautas";
}

async function stagePautas(run: RunState, config: AppConfig): Promise<void> {
  const insumos = run.insumos!;
  const quantidade = Math.min(Math.ceil(config.postsPerDay * 1.6), 10);
  const result = await runAgent<{ pautas: Pauta[] }>({
    agentPrompt: await getPrompt("pauteiro"),
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
    timeoutMs: 120_000, // por tentativa (2ª inverte pro deepseek) — 2x120 cabe no maxDuration
    maxTokens: 30000, // reasoning conta no budget — sem folga o JSON sai truncado
  });
  let pautasOut = result.pautas;
  if (pautasOut.length === 0) {
    // kimi às vezes devolve lista vazia como SUCESSO (08/jul às 5:57) — o retry
    // de erro não dispara. Segunda chance no haiku antes de desistir do dia.
    run.log.push("pauteiro: 0 pautas do titular, retry no haiku");
    const retry = await runAgent<{ pautas: Pauta[] }>({
      agentPrompt: await getPrompt("pauteiro"),
      stableDocs: [
        { tag: "linha_editorial", content: ASSETS.linhaEditorial },
        { tag: "victor_profile", content: ASSETS.victorProfile },
        { tag: "structure_bank", content: ASSETS.structureBank },
      ],
      dynamicDocs: [
        { tag: "insumos_resumo", content: `inbox: ${insumos.inbox.length} itens; trends: ${insumos.trends.map((t) => t.texto.slice(0, 120)).join(" | ") || "nenhum"}; fatos: ${insumos.facts.map((f) => f.fato.slice(0, 100)).join(" | ")}` },
        { tag: "historico_recente", content: insumos.historico.join("\n---\n") || "(nenhum post recente)" },
      ],
      task: {
        data: run.date,
        quantidade_pautas: quantidade,
        posts_do_dia: config.postsPerDay,
        instrucao: "lista vazia é proibido: entregue no MÍNIMO 2 pautas mesmo com insumo fraco (use os fatos do banco por ângulos novos)",
      },
      schema: PAUTAS_SCHEMA,
      effort: "medium",
      agent: "pauteiro",
      timeoutMs: 110_000,
      maxTokens: 20000,
      modelOverride: "anthropic/claude-haiku-4.5",
    });
    pautasOut = retry.pautas;
  }
  if (pautasOut.length === 0) {
    throw new Error("pauteiro devolveu 0 pautas (titular e retry) — insumos insuficientes");
  }
  const tag = run.startedAt.slice(11, 19).replace(/:/g, "");
  run.pautas = pautasOut.map((p, i) => ({ ...p, id: `${tag}p${i + 1}` }));
  run.log.push(`pauteiro: ${pautasOut.length} pautas (${pautasOut.map((p) => `${p.mov}/${p.forma ?? "?"}`).join(", ")})`);
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
        agentPrompt: await getPrompt("ghostwriter"),
        stableDocs: [
          { tag: "voice_model", content: ASSETS.voiceModel },
          { tag: "registro_acido", content: await getPrompt("registroAcido") },
          { tag: "registro_real", content: await getPrompt("registroReal") },
          { tag: "dicionario_de_voz", content: dicionarioDoc(await loadDicionario()) },
          { tag: "victor_profile", content: ASSETS.victorProfile },
        ],
        dynamicDocs: [
          { tag: "voice_seeds", content: seeds.join("\n---\n") },
          { tag: "mov_esqueleto", content: movBlock(pauta.mov) },
          { tag: "pauta", content: JSON.stringify(pauta, null, 2) },
          ...((run.insumos?.lessons ?? []).length > 0
            ? [
                {
                  tag: "licoes_recentes",
                  content: `Padrões que o crítico MATOU em runs anteriores — não repita nenhum:\n- ${(run.insumos?.lessons ?? []).join("\n- ")}`,
                },
              ]
            : []),
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

// construção banida reincidente ("não é sobre X, é sobre Y") — o crítico já
// deixou vazar uma vez (tweet das browser wars); lint em código não vacila
const LINT_NAO_E_SOBRE = /(n[aã]o [eé]|n[aã]o foi|nunca foi|n[aã]o [eé] quest[aã]o de) (mais )?(s[oó] )?sobre [^,.;\n]{2,60}[,;:—–-]+\s*[eé] sobre/i;

// ---- lints determinísticos de voz (pegam o que o julgamento por LLM deixa vazar) ----

const STOPWORDS = new Set(
  "o a os as um uma de do da dos das que q pra pro por em no na nos nas e é eh se vc voce com mas mais ou ja já nao não n eu meu minha sua seu isso esse essa ele ela tem ser foi como ao à te ta tá to tô".split(" ")
);

function stems(texto: string): Set<string> {
  return new Set(
    texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map((w) => w.slice(0, 5))
  );
}

// quase-duplicata semântica barata: Jaccard de radicais (pegou o "erro de
// validar produto antes do canal" saindo 2 dias seguidos com outras palavras)
function quaseIgual(a: string, b: string): boolean {
  const sa = stems(a);
  const sb = stems(b);
  if (sa.size < 6 || sb.size < 6) return false;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter) > 0.42;
}

// amostra de voz é régua de RITMO, não banco de frases: 6+ palavras literais
// de uma amostra dentro do draft = cópia ("só ajustando oq da pra ajustar" 2x)
function copiaDeAmostra(texto: string, amostras: string): string | null {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const alvo = norm(texto);
  for (const bloco of amostras.split(/\n/)) {
    const palavras = norm(bloco).split(" ");
    for (let i = 0; i + 6 <= palavras.length; i++) {
      const janela = palavras.slice(i, i + 6).join(" ");
      if (janela.length > 24 && alvo.includes(janela)) return janela;
    }
  }
  return null;
}

function lintDraft(texto: string, historico: string[], dic?: Dicionario): string | null {
  if (dic) {
    const v = violacaoDicionario(texto, dic);
    if (v) return `lint: ${v}`;
  }
  if (/[—–]/.test(texto)) {
    return "lint: travessão (— ou –) é banido na voz do Victor em qualquer hipótese — troque por vírgula, ponto ou quebra de linha";
  }
  if (LINT_NAO_E_SOBRE.test(texto)) {
    return "lint: construção banida 'não é sobre X, é sobre Y' (clichê de IA da banlist) — reescreva a virada com outra forma";
  }
  const copia = copiaDeAmostra(texto, ASSETS.voiceSamples + "\n" + ASSETS.registroReal);
  if (copia) {
    return `lint: copiou trecho literal de amostra de voz ("${copia}") — amostra é régua de ritmo, não banco de frases; diga a MESMA coisa com frase nova`;
  }
  if (historico.some((h) => quaseIgual(texto, h))) {
    return "lint: quase idêntico a post recente do histórico (mesma ideia, mesmas palavras-chave) — mude o TEMA da pauta, não só a redação";
  }
  return null;
}

// julga UM draft (fases A e B). Chamada pequena = termina rápido, ganha retry
// com inversão de modelo, e uma falha não derruba o lote — era a chamada única
// gigante do lote que estourava timeout em noite de provedor lento.
async function julgarUm(
  run: RunState,
  draft: { id: string; texto: string; pauta?: Pauta },
  contextoExtra?: string
): Promise<{ finalistas: Finalista[]; mortos: Morto[] }> {
  return runAgent<{ finalistas: Finalista[]; mortos: Morto[] }>({
    agentPrompt: await getPrompt("critico"),
    stableDocs: [
      { tag: "voice_model", content: ASSETS.voiceModel },
      { tag: "victor_profile", content: ASSETS.victorProfile },
      { tag: "algorithm_rules", content: ASSETS.algorithmRules },
      { tag: "registro_real", content: await getPrompt("registroReal") },
    ],
    dynamicDocs: [
      { tag: "anchors", content: (run.insumos?.voiceAnchors ?? []).join("\n---\n") },
      { tag: "drafts", content: JSON.stringify([draft], null, 2) },
      ...(contextoExtra ? [{ tag: "contexto", content: contextoExtra }] : []),
    ],
    task: { instrucao: "rode as fases A e B neste único draft (variedade/dedup do lote é papel do editor)" },
    schema: CRITICO_SCHEMA,
    effort: "low", // aplicar rubrica em 1 draft não precisa de raciocínio longo — corta ~50% do custo do juiz
    maxTokens: 5000,
    agent: "critico",
    timeoutMs: 70_000, // por tentativa; 2ª tentativa inverte pro fallback
  });
}

async function julgarLote(
  run: RunState,
  drafts: { id: string; texto: string; pauta?: Pauta }[],
  contextoExtra?: string
): Promise<{ finalistas: Finalista[]; mortos: Morto[] }> {
  // 1º draft sozinho AQUECE o prompt cache (system idêntico); os demais em
  // paralelo pagam 10% do input. Custa ~30s de latência, corta ~70% da conta.
  const [primeiro, ...resto] = drafts;
  const julgaSeguro = async (d: (typeof drafts)[number]) => {
      try {
        return await julgarUm(run, d, contextoExtra);
      } catch (err) {
        // julgamento indisponível = draft NÃO publica (seguro), mas é recuperável
        return {
          finalistas: [],
          mortos: [
            {
              id: d.id,
              motivo: `não julgado: crítico falhou 2x (${err instanceof Error ? err.message.slice(0, 60) : "erro"}) — tente de novo`,
            },
          ],
        };
      }
  };
  const partes = primeiro ? [await julgaSeguro(primeiro)] : [];
  partes.push(...(await Promise.all(resto.map(julgaSeguro))));
  return {
    finalistas: partes.flatMap((p) => p.finalistas),
    mortos: partes.flatMap((p) => p.mortos),
  };
}

async function stageCritico(run: RunState): Promise<void> {
  const pautasById = new Map((run.pautas ?? []).map((p) => [p.id, p]));
  const todos = (run.drafts ?? []).map((d) => ({
    id: d.pautaId,
    texto: d.texto,
    pauta: pautasById.get(d.pautaId),
  }));

  // lints determinísticos ANTES do LLM (motivo sem "p0" → recuperável → regen)
  const lintMortos: Morto[] = [];
  const historico = run.insumos?.historico ?? [];
  const dic = await loadDicionario();
  const drafts = todos.filter((d) => {
    const motivo = lintDraft(d.texto, historico, dic);
    if (motivo) {
      lintMortos.push({ id: d.id, motivo });
      return false;
    }
    return true;
  });
  if (lintMortos.length > 0) run.log.push(`crítico: lint matou ${lintMortos.length} draft(s) antes do LLM`);

  const r = drafts.length > 0 ? await julgarLote(run, drafts) : { finalistas: [], mortos: [] };
  const finalistas = r.finalistas;
  const mortos = [...lintMortos, ...r.mortos];

  run.finalistas = finalistas;
  run.mortos = mortos;
  run.log.push(
    `crítico: ${finalistas.length} finalistas (scores ${finalistas.map((f) => f.score).join(", ")}), ${mortos.length} mortos`
  );

  // auto-melhora: os motivos das mortes viram lições persistentes (o ghostwriter
  // dos próximos runs recebe e evita os mesmos padrões)
  try {
    const blob = (await getJSON<{ lessons: { d: string; t: string }[] }>("lessons.json")) ?? { lessons: [] };
    for (const m of mortos) {
      blob.lessons.push({ d: run.date, t: m.motivo.slice(0, 160) });
    }
    blob.lessons = blob.lessons.slice(-40);
    await putJSON("lessons.json", blob);
  } catch {
    run.log.push("aviso: falha ao salvar lições");
  }

  // regeneração: veto seco não — mortes recuperáveis ganham UMA rodada de
  // reescrita com o motivo como instrução
  const fixaveis = fixableMortos(mortos);
  if (finalistas.length < 3 && fixaveis.length > 0) {
    run.stage = "regen";
    return;
  }
  if (finalistas.length === 0) throw new Error("crítico matou todos os drafts (nenhum recuperável)");
  run.stage = "editor";
}

// morte por P0/invenção não se conserta reescrevendo; o resto é recuperável
function fixableMortos(mortos: Morto[]): Morto[] {
  return mortos.filter((m) => !/p0|veto duro|inventad|não tem lastro|nao tem lastro|sem lastro/i.test(m.motivo));
}

async function stageRegen(run: RunState): Promise<void> {
  const pautasById = new Map((run.pautas ?? []).map((p) => [p.id, p]));
  const draftsById = new Map((run.drafts ?? []).map((d) => [d.pautaId, d]));
  const alvos = fixableMortos(run.mortos ?? [])
    .filter((m) => pautasById.has(m.id) && draftsById.has(m.id))
    .slice(0, 3);

  if (alvos.length === 0) {
    if ((run.finalistas ?? []).length === 0) throw new Error("crítico matou todos os drafts (nenhum recuperável)");
    run.stage = "editor";
    return;
  }

  const rewrites = await Promise.allSettled(
    alvos.map(async (morto) => {
      const pauta = pautasById.get(morto.id)!;
      const original = draftsById.get(morto.id)!;
      const media = mediaItemOf(run, pauta);
      const seeds = sampleVoiceSeeds(ASSETS.voiceSamples, 4, `${run.id}-regen-${pauta.id}`);
      const out = await runAgent<{ texto: string; seed_descartada: string }>({
        agentPrompt: await getPrompt("ghostwriter"),
        stableDocs: [
          { tag: "voice_model", content: ASSETS.voiceModel },
          { tag: "registro_acido", content: await getPrompt("registroAcido") },
          { tag: "registro_real", content: await getPrompt("registroReal") },
          { tag: "dicionario_de_voz", content: dicionarioDoc(await loadDicionario()) },
          { tag: "victor_profile", content: ASSETS.victorProfile },
        ],
        dynamicDocs: [
          { tag: "voice_seeds", content: seeds.join("\n---\n") },
          { tag: "mov_esqueleto", content: movBlock(pauta.mov) },
          { tag: "pauta", content: JSON.stringify(pauta, null, 2) },
          {
            tag: "correcao_do_critico",
            content: `Seu draft anterior desta pauta foi MORTO pelo crítico.\nDraft morto:\n${original.texto}\n\nMotivo da morte: ${morto.motivo}\n\nReescreva a MESMA pauta do zero corrigindo exatamente esse problema (não recicle as frases do draft morto).`,
          },
          ...(media
            ? [{ tag: "print_anexado", content: `Este post SAI com um print anexado. O que mostra: ${media.mediaDescricao ?? media.texto}. Referencie, não reescreva os números.` }]
            : []),
        ],
        task: { instrucao: "reescreva o tweet corrigindo o motivo da morte" },
        schema: DRAFT_SCHEMA,
        effort: "high",
        maxTokens: 12000,
        agent: "ghostwriter",
      });
      return { pautaId: pauta.id, texto: out.texto } as Draft;
    })
  );

  const novos = rewrites.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (novos.length === 0) {
    run.log.push("regen: todas as reescritas falharam");
    if ((run.finalistas ?? []).length === 0) throw new Error("crítico matou todos e regen falhou");
    run.stage = "editor";
    return;
  }

  // segunda passada do crítico só nas reescritas — mesmo caminho per-draft do
  // stageCritico (chamada pequena com retry invertido; sem lote gigante)
  const draftsComPauta = novos.map((d) => ({ id: d.pautaId, texto: d.texto, pauta: pautasById.get(d.pautaId) }));
  const historico = run.insumos?.historico ?? [];
  const dicRegen = await loadDicionario();
  const lintados = draftsComPauta.filter((d) => {
    const motivo = lintDraft(d.texto, historico, dicRegen);
    if (motivo) {
      run.mortos = [...(run.mortos ?? []), { id: d.id, motivo: `${motivo} (na reescrita)` }];
      return false;
    }
    return true;
  });
  const result = await julgarLote(
    run,
    lintados,
    `Este draft é uma REESCRITA de um draft morto na primeira rodada. Finalistas já aprovados do dia (não é papel seu deduplicar, mas conte como contexto): ${JSON.stringify((run.finalistas ?? []).map((f) => f.texto))}`
  );

  // substitui os drafts mortos pelas reescritas aprovadas
  run.drafts = (run.drafts ?? []).map((d) => novos.find((n) => n.pautaId === d.pautaId) ?? d);
  run.finalistas = [...(run.finalistas ?? []), ...result.finalistas];
  run.mortos = [...(run.mortos ?? []).filter((m) => !novos.find((n) => n.pautaId === m.id)), ...result.mortos];
  run.log.push(
    `regen: ${novos.length} reescritas, +${result.finalistas.length} finalistas aprovados (total ${run.finalistas.length})`
  );
  if (run.finalistas.length === 0) throw new Error("crítico matou todos, inclusive as reescritas");
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
    agentPrompt: await getPrompt("editor"),
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

  // dedup determinístico ("memória mínima" que o LLM não garante): 2 posts do
  // mesmo dia não podem abrir com a mesma fórmula nem citar o mesmo canal-fonte
  // (06/jul saíram "vi uma thread no r/sideproject" E "vi rolando no r/sideproject")
  const textoDe = (id: string) => (run.finalistas ?? []).find((f) => f.id === id)?.texto ?? "";
  const abertura = (t: string) => t.toLowerCase().split(/\s+/).slice(0, 2).join(" ");
  const fingerprint = (t: string) => {
    const n = t.split("\n").filter((l) => l.trim()).length;
    const bucket = n <= 1 ? "1" : n === 2 ? "2" : n <= 5 ? "3-5" : "6+";
    const fim = t.trim();
    const fecho = /\.\.$/.test(fim) ? ".." : /\?$/.test(fim) ? "?" : /kk+\S*$/i.test(fim) ? "kk" : "seco";
    return bucket + ":" + fecho;
  };
  const canais = (t: string) => (t.toLowerCase().match(/r\/[a-z0-9_]+|hacker news|\bhn\b|product hunt/g) ?? []);
  const escolhidos: Selecionado[] = [];
  const vistosAbertura = new Set<string>();
  const vistosCanal = new Set<string>();
  const vistosForma = new Set<string>();
  const citandoTotal = () => escolhidos.filter((e) => canais(textoDe(e.id)).length > 0).length;
  const clash = (t: string) =>
    vistosAbertura.has(abertura(t)) ||
    vistosForma.has(fingerprint(t)) ||
    canais(t).some((c) => vistosCanal.has(c)) ||
    (canais(t).length > 0 && citandoTotal() >= 2);
  const marca = (t: string) => {
    vistosAbertura.add(abertura(t));
    vistosForma.add(fingerprint(t));
    for (const c of canais(t)) vistosCanal.add(c);
  };
  const fila = [...result.selecionados];
  const reservas = (run.finalistas ?? [])
    .filter((f) => !fila.some((s) => s.id === f.id))
    .sort((a, b) => b.score - a.score);
  for (const sel of fila) {
    const t = textoDe(sel.id);
    if (!clash(t)) { escolhidos.push(sel); marca(t); continue; }
    const substituto = reservas.find((f) => !clash(f.texto) && !escolhidos.some((e) => e.id === f.id));
    if (substituto) {
      escolhidos.push({ ...sel, id: substituto.id });
      marca(substituto.texto);
      run.log.push(`editor-troca: ${sel.id} repetia abertura/canal do dia → entrou ${substituto.id}`);
    } else {
      run.log.push(`editor-corte: ${sel.id} repetia abertura/canal e não havia reserva sem repetição`);
    }
  }
  run.selecionados = escolhidos.slice(0, config.postsPerDay);

  // PISO (nunca zerar com material na mesa): se o LLM+dedup descartou TUDO por
  // "repete tema de ontem", repetir um tema um dia depois é melhor que slot
  // vazio. Pega os melhores finalistas diversos ENTRE SI (variedade do dia >
  // variedade vs ontem). Era o bug de 07/jul: 4 finalistas 80-88, editor zerou.
  if (run.selecionados.length === 0 && (run.finalistas ?? []).length > 0) {
    const piso: Selecionado[] = [];
    const vA = new Set<string>();
    const vC = new Set<string>();
    const vF = new Set<string>();
    for (const f of [...(run.finalistas ?? [])].sort((a, b) => b.score - a.score)) {
      if (piso.length >= config.postsPerDay) break;
      if (piso.length > 0 && (vA.has(abertura(f.texto)) || vF.has(fingerprint(f.texto)) || canais(f.texto).some((c) => vC.has(c)))) continue;
      piso.push({ id: f.id, rank: piso.length + 1, janela: piso.length === 0 ? "almoco" : "tarde", motivo: "piso: melhor finalista (editor havia zerado por dedup vs agenda)" });
      vA.add(abertura(f.texto));
      vF.add(fingerprint(f.texto));
      for (const c of canais(f.texto)) vC.add(c);
    }
    run.selecionados = piso;
    run.log.push(`editor-piso: ${piso.length} na força — LLM descartou todos por tema vs ontem, mas há finalista aprovado`);
  }

  run.log.push(`editor: ${run.selecionados.length} selecionados, ${result.descartados.length} descartados`);
  for (const d of result.descartados) run.log.push(`editor-descartou ${d.id}: ${d.motivo.slice(0, 100)}`);
  if (run.selecionados.length === 0) throw new Error("editor não selecionou nenhum post (sem finalistas)");
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
      case "regen":
        await stageRegen(run);
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
    let alvo = run.failedStage;
    // roteamento são: nunca retomar num estágio cujas precondições não existem
    if ((alvo === "drafts" || alvo === "critico" || alvo === "regen" || alvo === "editor") && (run.pautas ?? []).length === 0) alvo = "pautas";
    else if ((alvo === "critico" || alvo === "regen") && (run.drafts ?? []).length === 0) alvo = "drafts";
    else if ((alvo === "editor" || alvo === "agendar") && (run.finalistas ?? []).length === 0 && alvo !== "editor") alvo = "critico";
    if (alvo !== "gather" && !run.insumos) alvo = "gather";
    run.stage = alvo;
    run.error = undefined;
    run.log.push(`retomando do estágio ${alvo}`);
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
