import { getJSON, putJSON } from "./store";

// Dicionário de voz editável pelo dashboard — o "negative keywords" do Victor.
// Banidas: mata draft no lint (código, determinístico). Preferidas: entram no
// prompt do ghostwriter como vocabulário com dose. Fonte da verdade no Blob;
// o seed abaixo só vale enquanto o Victor não salvar a primeira edição.

export interface TermoBanido {
  termo: string;
  tipo: "palavra" | "frase" | "regex";
  motivo: string;
  ativo: boolean;
}

export interface TermoPreferido {
  termo: string;
  nota: string; // dose/quando usar
  ativo: boolean;
}

export interface Dicionario {
  banidas: TermoBanido[];
  preferidas: TermoPreferido[];
  atualizadoEm?: string;
}

const PATH = "config/dicionario.json";

export const DICIONARIO_SEED: Dicionario = {
  banidas: [
    { termo: "—", tipo: "palavra", motivo: "travessão é tell de IA (veto permanente)", ativo: true },
    { termo: "falo por experiência própria", tipo: "frase", motivo: "fórmula-template que vazou do prompt e repetiu em vários posts", ativo: true },
    { termo: "(n[aã]o [eé]|n[aã]o foi|nunca foi)\\s+(mais\\s+)?(s[oó]\\s+)?sobre\\s+[^,.;\\n]{2,60}[,;:]+\\s*[eé]\\s+sobre", tipo: "regex", motivo: "construção 'não é sobre X, é sobre Y' e variantes", ativo: true },
    { termo: "\\b\\d\\s+(de|em)\\s+(cada\\s+)?10\\b", tipo: "regex", motivo: "estatística-clichê de abertura ('9 de 10 founder...')", ativo: true },
  ],
  preferidas: [],
};

export async function loadDicionario(): Promise<Dicionario> {
  const d = await getJSON<Dicionario>(PATH);
  if (d && Array.isArray(d.banidas)) return d;
  return DICIONARIO_SEED;
}

export async function saveDicionario(d: Dicionario): Promise<void> {
  await putJSON(PATH, { ...d, atualizadoEm: new Date().toISOString() });
}

// aplica as banidas ativas a um texto; devolve o motivo do primeiro hit ou null
export function violacaoDicionario(texto: string, dic: Dicionario): string | null {
  for (const b of dic.banidas) {
    if (!b.ativo) continue;
    try {
      if (b.tipo === "regex") {
        if (new RegExp(b.termo, "i").test(texto)) return `dicionário: padrão banido (${b.motivo})`;
      } else if (b.tipo === "frase") {
        if (texto.toLowerCase().includes(b.termo.toLowerCase())) return `dicionário: frase banida "${b.termo}" (${b.motivo})`;
      } else {
        const re = new RegExp(`(^|[^\\p{L}\\p{N}])${b.termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");
        if (re.test(texto)) return `dicionário: palavra banida "${b.termo}" (${b.motivo})`;
      }
    } catch {
      // regex inválida salva pelo usuário não pode derrubar o pipeline
    }
  }
  return null;
}

// bloco pro prompt do ghostwriter (vocabulário dele, com dose)
export function dicionarioDoc(dic: Dicionario): string {
  const banidas = dic.banidas.filter((b) => b.ativo).map((b) => `- NUNCA: ${b.tipo === "regex" ? `padrão ${b.termo}` : `"${b.termo}"`} (${b.motivo})`);
  const preferidas = dic.preferidas.filter((p) => p.ativo).map((p) => `- "${p.termo}" — ${p.nota}`);
  return [
    banidas.length ? `## Banidas (lint em código mata o draft que usar)\n${banidas.join("\n")}` : "",
    preferidas.length ? `## Vocabulário real do Victor (use na dose indicada, não force)\n${preferidas.join("\n")}` : "",
  ].filter(Boolean).join("\n\n") || "(dicionário vazio)";
}
