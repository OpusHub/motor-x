import Anthropic from "@anthropic-ai/sdk";

// Wrapper dos agentes: system estável (prompt do agente + assets canônicos) +
// documentos dinâmicos e task no turno de usuário. Multi-provider:
// - openrouter (default quando OPENROUTER_API_KEY existe): modelos chineses
//   baratos via API OpenAI-compatible. Default: moonshotai/kimi-k2.6
//   (melhor open-weight pra escrita, ~10x mais barato que Opus).
// - anthropic: claude-opus-4-8 com structured outputs + adaptive thinking.

const anthropicClient = () => new Anthropic({ maxRetries: 4 });

type Provider = "openrouter" | "anthropic";

function provider(): Provider {
  const p = process.env.LLM_PROVIDER;
  if (p === "openrouter" || p === "anthropic") return p;
  return process.env.OPENROUTER_API_KEY ? "openrouter" : "anthropic";
}

export type AgentName = "pauteiro" | "ghostwriter" | "critico" | "editor";

// Modelo por agente: MODEL_PAUTEIRO / MODEL_GHOSTWRITER / MODEL_CRITICO /
// MODEL_EDITOR vencem; senao MODEL_ID; senao o default POR AGENTE abaixo.
// Decisao 06/jul: a VOZ e o produto — ghostwriter e critico rodam Sonnet 5
// ($2/$10 por M; volume diario minusculo ≈ $0,25/dia) porque kimi/deepseek
// escrevem staccato e o gate cego deles nao sente. Plumbing (pauteiro/editor)
// segue kimi barato. Fallback em runtime continua deepseek pra resiliencia.
const AGENT_DEFAULTS: Record<AgentName, string> = {
  // pauteiro tambem sonnet (06/jul): e a UNICA chamada grande inevitavel
  // (structure-bank inteiro) e kimi E deepseek estouraram 120s x2 na manha
  // de 06/jul — capacidade paga nao congestiona. ~$0,07/dia.
  pauteiro: "anthropic/claude-sonnet-5",
  ghostwriter: "anthropic/claude-sonnet-5",
  critico: "anthropic/claude-sonnet-5",
  editor: "moonshotai/kimi-k2.6",
};
const MODEL = (agent?: AgentName) =>
  (agent && process.env[`MODEL_${agent.toUpperCase()}`]) ||
  process.env.MODEL_ID ||
  (provider() === "openrouter"
    ? (agent && AGENT_DEFAULTS[agent]) || "moonshotai/kimi-k2.6"
    : "claude-opus-4-8");

// Alguns modelos devolvem o JSON entre cercas ou com preâmbulo — extrai robusto.
function extractJSON<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]) as T;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1)) as T;
    throw new Error(`resposta não é JSON: ${raw.slice(0, 200)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runOpenRouter<T>(opts: {
  systemText: string;
  userText: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  timeoutMs: number;
  agent?: AgentName;
}): Promise<T> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY ausente");
  let lastErr: Error | null = null;
  const FALLBACK_MODEL = "deepseek/deepseek-v4-pro";
  // SEMPRE 2 tentativas: a 2ª inverte pro fallback (deepseek). Quem chama
  // dimensiona timeoutMs*2 dentro do orçamento do estágio (maxDuration 300s).
  const attempts = 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    // Timeout por tentativa: sem isso uma geração pendurada segura a função
    // serverless até o hard-limit de 300s e o run inteiro trava.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://motorx-opus.vercel.app",
          "X-Title": "Motor X",
        },
        body: JSON.stringify({
          model: attempt === 0 ? MODEL(opts.agent) : FALLBACK_MODEL,
          // fallback oficial: se o primário falhar no provedor, o OpenRouter
          // troca na MESMA request. Na 2ª tentativa a ordem INVERTE — timeout
          // não é "falha de provedor", então sem isso a retry batia de novo
          // no mesmo modelo lento (visto na noite de 04/jul: kimi degradado).
          models:
            attempt === 0
              ? Array.from(new Set([MODEL(opts.agent), FALLBACK_MODEL]))
              : Array.from(new Set([FALLBACK_MODEL, MODEL(opts.agent)])),
          // só roteia pra provedores que suportam json_schema/reasoning
          provider: { require_parameters: true },
          max_tokens: opts.maxTokens,
          // limita o "pensamento" do modelo de reasoning — tweet não precisa
          // de 10 minutos de cadeia de raciocínio
          reasoning: { effort: opts.effort },
          messages: [
            { role: "system", content: opts.systemText },
            {
              role: "user",
              content: `${opts.userText}\n\nResponda SOMENTE com o JSON no formato pedido, sem texto fora do JSON.`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "output", strict: true, schema: opts.schema },
          },
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`OpenRouter ${res.status}`);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message}`);
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        lastErr = new Error("OpenRouter: resposta vazia");
        continue;
      }
      return extractJSON<T>(content);
    } catch (err) {
      if (err instanceof Error && /OpenRouter \d{3}:/.test(err.message)) throw err; // 4xx não-retryable
      lastErr =
        err instanceof Error && err.name === "AbortError"
          ? new Error(`OpenRouter: timeout de ${Math.round(opts.timeoutMs / 1000)}s na geração`)
          : err instanceof Error
            ? err
            : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("OpenRouter: falha após retries");
}

export interface AgentDoc {
  tag: string;
  content: string;
}

// MOCK_LLM=1: devolve saídas canônicas por formato de schema — testa toda a
// tubulação (estados, Blob, Zernio, agendamento, Telegram) sem gastar tokens.
function mockResponse(schema: Record<string, unknown>, dynamicDocs: AgentDoc[]): unknown {
  const props = Object.keys((schema.properties as Record<string, unknown>) ?? {});
  if (props.includes("pautas")) {
    return {
      pautas: [
        {
          id: "p1", pilar: 2, objetivo: "prova", mov: "MOV-02", idioma: "pt",
          fato: { texto: "teste de tubulação do motor x (mock)", fonte: "e2e", origem: "banco" },
          angulo: "post de validação do pipeline, não é conteúdo real",
        },
        {
          id: "p2", pilar: 1, objetivo: "alcance", mov: "MOV-14", idioma: "pt",
          fato: { texto: "segundo fato de teste (mock)", fonte: "e2e", origem: "banco" },
          angulo: "segundo post de validação",
        },
      ],
    };
  }
  if (props.includes("finalistas")) {
    const drafts = dynamicDocs.find((d) => d.tag === "drafts")?.content ?? "[]";
    const parsed = JSON.parse(drafts) as { id: string; texto: string }[];
    return {
      finalistas: parsed.map((d) => ({ id: d.id, texto: d.texto, score: 81, mudancas: "mock: sem cortes" })),
      mortos: [],
    };
  }
  if (props.includes("selecionados")) {
    const finalistas = dynamicDocs.find((d) => d.tag === "finalistas")?.content ?? "[]";
    const parsed = JSON.parse(finalistas) as { id: string }[];
    return {
      selecionados: parsed.map((f, i) => ({
        id: f.id, rank: i + 1, janela: i % 2 === 0 ? "almoco" : "tarde", motivo: "mock",
      })),
      descartados: [],
    };
  }
  // ghostwriter
  const pauta = dynamicDocs.find((d) => d.tag === "pauta")?.content ?? "{}";
  const id = (JSON.parse(pauta) as { id?: string }).id ?? "?";
  return {
    texto: `[teste do motor x, ignora] tubulação validada, pauta ${id}.. isso nunca publica de verdade kk`,
    seed_descartada: "(mock)",
    autocheck: { fato_da_pauta: true, sem_travessao: true, idioma_unico: true },
  };
}

export async function runAgent<T>(opts: {
  agentPrompt: string;
  stableDocs: AgentDoc[]; // iguais em toda chamada do agente — entram no system (cacheável)
  dynamicDocs: AgentDoc[]; // variam por chamada — entram no user
  task: unknown;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  timeoutMs?: number;
  agent?: AgentName;
}): Promise<T> {
  if (process.env.MOCK_LLM === "1") {
    return mockResponse(opts.schema, opts.dynamicDocs) as T;
  }
  const stable = opts.stableDocs.map((d) => `<${d.tag}>\n${d.content}\n</${d.tag}>`).join("\n\n");
  const dynamic = opts.dynamicDocs.map((d) => `<${d.tag}>\n${d.content}\n</${d.tag}>`).join("\n\n");
  const userText = `${dynamic}${dynamic ? "\n\n" : ""}<task>\n${JSON.stringify(opts.task, null, 2)}\n</task>`;
  const systemText = `${opts.agentPrompt}\n\n${stable}`;

  if (provider() === "openrouter") {
    return runOpenRouter<T>({
      systemText,
      userText,
      schema: opts.schema,
      maxTokens: opts.maxTokens ?? 16000,
      effort: opts.effort ?? "medium",
      timeoutMs: opts.timeoutMs ?? 80_000,
      agent: opts.agent,
    });
  }

  const response = await anthropicClient().messages.create({
    model: MODEL(),
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: opts.effort ?? "high",
      format: { type: "json_schema", schema: opts.schema },
    },
    system: [
      {
        type: "text",
        text: systemText,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userText }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("modelo recusou a request (stop_reason: refusal)");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("output truncado (max_tokens) — aumentar maxTokens");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("resposta sem bloco de texto");
  return JSON.parse(text.text) as T;
}

// Amostra determinística-por-dia de exemplos do voice-samples (3-5, diversos).
// Blocos de exemplo = linhas que começam com "> " ou trechos entre crases no arquivo;
// fallback: parágrafos curtos. Mantém a lei anti-caixa: poucos exemplos, variados.
export function sampleVoiceSeeds(voiceSamples: string, count: number, seedKey: string): string[] {
  const blocks = voiceSamples
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 40 && b.length < 600 && !b.startsWith("#"));
  if (blocks.length === 0) return [];
  let h = 2166136261;
  for (const c of seedKey) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const out: string[] = [];
  const used = new Set<number>();
  for (let i = 0; out.length < Math.min(count, blocks.length) && i < blocks.length * 3; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const idx = h % blocks.length;
    if (!used.has(idx)) {
      used.add(idx);
      out.push(blocks[idx]);
    }
  }
  return out;
}

// Lê um print/imagem do inbox e devolve uma descrição rica pro pipeline
// (o que mostra, números visíveis, contexto). Best-effort: falha vira "".
export async function describeImage(url: string): Promise<string> {
  if (process.env.MOCK_LLM === "1") return "(mock: print de dashboard com métricas)";
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://motorx-opus.vercel.app",
        "X-Title": "Motor X",
      },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 2000,
        reasoning: { effort: "low" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url } },
              {
                type: "text",
                text: "Descreva este print pra um redator usar num tweet: o que a tela mostra, TODOS os números/métricas visíveis (exatos), nomes de plataformas/apps, e o que prova. Seja factual, 4-6 linhas, pt-BR.",
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
