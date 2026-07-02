import Anthropic from "@anthropic-ai/sdk";

// Wrapper dos agentes: system estável (prompt do agente + assets canônicos, com
// prompt caching) + documentos dinâmicos e task no turno de usuário.
// Structured outputs (output_config.format) garante JSON válido — sem parse frágil.

const client = new Anthropic({ maxRetries: 4 });

const MODEL = () => process.env.MODEL_ID || "claude-opus-4-8";

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
}): Promise<T> {
  if (process.env.MOCK_LLM === "1") {
    return mockResponse(opts.schema, opts.dynamicDocs) as T;
  }
  const stable = opts.stableDocs.map((d) => `<${d.tag}>\n${d.content}\n</${d.tag}>`).join("\n\n");
  const dynamic = opts.dynamicDocs.map((d) => `<${d.tag}>\n${d.content}\n</${d.tag}>`).join("\n\n");
  const userText = `${dynamic}${dynamic ? "\n\n" : ""}<task>\n${JSON.stringify(opts.task, null, 2)}\n</task>`;

  const response = await client.messages.create({
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
        text: `${opts.agentPrompt}\n\n${stable}`,
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
