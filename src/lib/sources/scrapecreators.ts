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

// sinal de que o post é sobre o nicho do Victor (negócio/build/IA/distribuição)
// e não sobre assunto genérico da conta (levelsio posta Apple Maps, Dubai...)
const NEGOCIO = /\b(build|ship|launch|shipp|revenue|mrr|arr|saas|startup|founder|indie|product|grow|market|churn|pricing|paywall|users?|customer|scale|hire|team|distribut|funnel|\bads?\b|agent|\bai\b|llm|gpt|monetiz|bootstrap|solopreneur|acquir|audience|content|creator|conversion|retention|onboard|feature|mvp|niche|profit|sell|sold|business)\b/i;

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

// formato real do X GraphQL que o ScrapeCreators repassa: texto e métricas
// ficam em tweet.legacy.*, views em tweet.views.count
interface XTweet {
  legacy?: {
    full_text?: string;
    favorite_count?: number;
    retweet_count?: number;
    reply_count?: number;
    bookmark_count?: number;
    created_at?: string;
    lang?: string;
    in_reply_to_status_id_str?: string;
    retweeted_status_result?: unknown;
  };
  views?: { count?: string | number };
  url?: string;
}

async function fetchJSON<T>(path: string): Promise<T | null> {
  const key = KEY();
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// posts recentes das contas-referência → matéria pra COMENTAR (o take do Victor
// reagindo ao que o nicho dele está discutindo hoje). Só posts ORIGINAIS (sem
// reply/RT), priorizando os com tração.
export async function nicheChatter(limit = 6): Promise<TrendItem[]> {
  if (!KEY()) return [];
  const contas = contasAlvo();
  const porConta = await Promise.all(
    contas.map(async (handle) => {
      const data = await fetchJSON<{ tweets?: XTweet[] }>(`/twitter/user-tweets?handle=${encodeURIComponent(handle)}`);
      const tweets = (data?.tweets ?? []).filter((t) => {
        const lg = t.legacy;
        const txt = (lg?.full_text ?? "").toLowerCase();
        // só posts ORIGINAIS e sobre NEGÓCIO/build/founder — sem esse filtro
        // vinha Apple Maps / solar farm de Dubai e o pauteiro ignorava o ruído
        return (
          txt.length > 40 &&
          !lg?.in_reply_to_status_id_str &&
          !lg?.retweeted_status_result &&
          !txt.startsWith("rt @") &&
          NEGOCIO.test(txt)
        );
      });
      // ordena por views (os mais fortes primeiro), pega os 2 melhores por conta
      const views = (t: XTweet) => Number(t.views?.count ?? 0);
      return tweets
        .sort((a, b) => views(b) - views(a))
        .slice(0, 2)
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
        const lg = item.t.legacy;
        const txt = (lg?.full_text ?? "").replace(/https:\/\/t\.co\/\w+/g, "").trim().slice(0, 260);
        const v = Number(item.t.views?.count ?? 0);
        const eng = v > 0 ? `${v.toLocaleString("pt-BR")} views` : `${lg?.favorite_count ?? 0} likes`;
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

interface XProfile {
  legacy?: { followers_count?: number; statuses_count?: number; media_count?: number };
  core?: { name?: string; screen_name?: string };
}

// métrica FRESCA de uma conta do Victor (ex: avatar) — pro banco nunca cravar
// número que envelhece. Retorna null se sem key ou conta não achada.
export async function contaMetrica(handle: string): Promise<{ followers?: number; posts?: number } | null> {
  const data = await fetchJSON<XProfile>(`/twitter/profile?handle=${encodeURIComponent(handle.replace(/^@/, ""))}`);
  if (!data?.legacy) return null;
  return { followers: data.legacy.followers_count, posts: data.legacy.statuses_count };
}
