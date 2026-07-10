import { TrendItem } from "../types";

// ScrapeCreators (scrapecreators.com): puxa dados PÚBLICOS de X/IG/TikTok/YT
// sem login da conta alvo (sem risco de flag, ao contrário de scraper com
// cookie). Resolve 2 problemas de uma vez:
//   1. Fonte de "comentar o que a galera do nicho tá falando AGORA" — puxa os
//      posts recentes das contas que o Victor modela → âncora externa fresca
//      (muda todo dia = antídoto de repetição).
//   2. Número sempre fresco — puxa métrica atual dos posts/contas em vez de
//      cravar um número que envelhece (ex: avatar "409k" vira o valor de hoje).
// Sem SCRAPECREATORS_API_KEY: no-op silencioso, o grátis (Reddit/HN/PH) segue.

const KEY = () => process.env.SCRAPECREATORS_API_KEY;
const BASE = "https://api.scrapecreators.com/v1";

// contas-referência do nicho do Victor (founders/indie/SaaS que ele modela).
// Editável por env SCRAPECREATORS_ACCOUNTS (csv) sem deploy.
const CONTAS_PADRAO = ["condzxyz", "levelsio", "gregisenberg", "arvidkahl", "dvassallo", "marclou"];

function contasAlvo(): string[] {
  const env = process.env.SCRAPECREATORS_ACCOUNTS;
  return env ? env.split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean) : CONTAS_PADRAO;
}

export function scrapeCreatorsEnabled(): boolean {
  return !!KEY();
}

interface XPost {
  text?: string;
  full_text?: string;
  favorite_count?: number;
  retweet_count?: number;
  view_count?: number;
  bookmark_count?: number;
  created_at?: string;
  url?: string;
}

async function fetchJSON<T>(path: string): Promise<T | null> {
  const key = KEY();
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// posts recentes das contas-referência → matéria pra COMENTAR (o take do Victor
// reagindo ao que o nicho dele está discutindo hoje). Prioriza os com tração.
export async function nicheChatter(limit = 6): Promise<TrendItem[]> {
  if (!KEY()) return [];
  const contas = contasAlvo();
  const porConta = await Promise.all(
    contas.map(async (handle) => {
      const data = await fetchJSON<{ tweets?: XPost[] }>(`/twitter/user-tweets?handle=${encodeURIComponent(handle)}`);
      const tweets = data?.tweets ?? [];
      // só posts recentes (72h) com alguma tração — não replies/ruído
      return tweets
        .filter((t) => (t.text ?? t.full_text ?? "").length > 40)
        .slice(0, 3)
        .map((t) => ({ handle, t }));
    })
  );
  // intercala as contas pra variar a voz de origem
  const out: TrendItem[] = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const lista of porConta) {
      const item = lista[i];
      if (item) {
        const txt = (item.t.text ?? item.t.full_text ?? "").slice(0, 260);
        const eng = item.t.view_count ? `${item.t.view_count} views` : `${item.t.favorite_count ?? 0} likes`;
        out.push({
          texto: txt,
          autor: `@${item.handle}`,
          url: item.t.url,
          metricas: `post do nicho pra comentar (${eng})`,
        });
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return out;
}

// métrica FRESCA de uma conta do Victor (ex: avatar) — pro banco nunca cravar
// número que envelhece. Retorna null se sem key ou conta não achada.
export async function contaMetrica(handle: string): Promise<{ followers?: number; totalViews?: number } | null> {
  const data = await fetchJSON<{ followers_count?: number; total_views?: number }>(
    `/twitter/profile?handle=${encodeURIComponent(handle.replace(/^@/, ""))}`
  );
  if (!data) return null;
  return { followers: data.followers_count, totalViews: data.total_views };
}
