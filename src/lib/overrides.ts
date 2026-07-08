import { AGENTS, ASSETS } from "@/prompts/bundle";
import { getJSON, putJSON, del } from "./store";

// Prompts editáveis pelo dashboard: override no Blob vence o default do bundle.
// O Victor edita no front sem depender de deploy; "restaurar" apaga o override.

export const PROMPT_KEYS = {
  pauteiro: { fonte: () => AGENTS.pauteiro, titulo: "Pauteiro (escolhe os assuntos)" },
  ghostwriter: { fonte: () => AGENTS.ghostwriter, titulo: "Ghostwriter (escreve na voz)" },
  critico: { fonte: () => AGENTS.critico, titulo: "Crítico (mata o que não presta)" },
  editor: { fonte: () => AGENTS.editor, titulo: "Editor (seleciona e ordena o dia)" },
  registroAcido: { fonte: () => ASSETS.registroAcido, titulo: "Registro ácido (camada de tom)" },
  registroReal: { fonte: () => ASSETS.registroReal ?? "", titulo: "Registro real (ponte pra voz oral)" },
} as const;

export type PromptKey = keyof typeof PROMPT_KEYS;

const path = (k: PromptKey) => `config/prompts/${k}.md`;

// cache curto por invocação: o crítico per-draft chama várias vezes no mesmo run
const cache = new Map<string, { v: string; t: number }>();
const TTL = 60_000;

export async function getPrompt(k: PromptKey): Promise<string> {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const override = await getJSON<{ md: string }>(path(k)).catch(() => null);
  const v = override?.md?.trim() ? override.md : PROMPT_KEYS[k].fonte();
  cache.set(k, { v, t: Date.now() });
  return v;
}

export async function setPromptOverride(k: PromptKey, md: string): Promise<void> {
  await putJSON(path(k), { md, salvoEm: new Date().toISOString() });
  cache.delete(k);
}

export async function resetPrompt(k: PromptKey): Promise<void> {
  await del(path(k)).catch(() => {});
  cache.delete(k);
}

export async function listPrompts(): Promise<
  { key: PromptKey; titulo: string; conteudo: string; customizado: boolean }[]
> {
  const out = [];
  for (const k of Object.keys(PROMPT_KEYS) as PromptKey[]) {
    const override = await getJSON<{ md: string }>(path(k)).catch(() => null);
    out.push({
      key: k,
      titulo: PROMPT_KEYS[k].titulo,
      conteudo: override?.md?.trim() ? override.md : PROMPT_KEYS[k].fonte(),
      customizado: !!override?.md?.trim(),
    });
  }
  return out;
}
