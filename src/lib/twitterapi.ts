import { TrendItem } from "./types";

// twitterapi.io — LEITURA do X (nunca escrita; escrita é só via Zernio).
// Fontes de fato real: tweets recentes do @victoryulo (âncora viva de voz) e
// posts quentes do nicho (slot de fato pra MOV-07/MOV-29). Tudo best-effort.

const BASE = "https://api.twitterapi.io";

function headers(): Record<string, string> | null {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) return null;
  return { "X-API-Key": key };
}

interface ApiTweet {
  text?: string;
  author?: { userName?: string };
  url?: string;
  likeCount?: number;
  retweetCount?: number;
  viewCount?: number;
}

async function tfetch(path: string): Promise<{ tweets?: ApiTweet[] } | null> {
  const h = headers();
  if (!h) return null;
  try {
    const res = await fetch(`${BASE}${path}`, { headers: h, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { tweets?: ApiTweet[] };
  } catch {
    return null;
  }
}

export async function victorRecentTweets(limit = 8): Promise<string[]> {
  const data = await tfetch(`/twitter/user/last_tweets?userName=victoryulo`);
  return (data?.tweets ?? [])
    .map((t) => t.text ?? "")
    .filter((t) => t.length > 0 && !t.startsWith("RT @"))
    .slice(0, limit);
}

const NICHE_QUERIES = [
  '("IA" OR "agentes") (distribuição OR marketing OR founder) lang:pt min_faves:200 within_time:24h',
  '(SaaS OR startup) (CAC OR churn OR growth) lang:pt min_faves:150 within_time:24h',
];

export async function nicheTrends(limit = 6): Promise<TrendItem[]> {
  const out: TrendItem[] = [];
  for (const q of NICHE_QUERIES) {
    const data = await tfetch(`/twitter/tweet/advanced_search?query=${encodeURIComponent(q)}&queryType=Top`);
    for (const t of data?.tweets ?? []) {
      if (!t.text) continue;
      out.push({
        texto: t.text.slice(0, 400),
        autor: t.author?.userName ?? "?",
        url: t.url,
        metricas: `${t.likeCount ?? 0} likes / ${t.viewCount ?? 0} views`,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
