import { TrendItem } from "../types";

// Product Hunt via feed Atom público — os lançamentos do dia. Alvo perfeito
// pro take ácido/contrário: hype de tool nova vs realidade de quem opera.

function limpa(s: string): string {
  // 1º desescapa entidades (o feed manda HTML escapado), DEPOIS tira as tags
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function productHuntSignal(limit = 2): Promise<TrendItem[]> {
  try {
    const res = await fetch("https://www.producthunt.com/feed", {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; motorx/1.0)" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const out: TrendItem[] = [];
    for (const chunk of xml.split(/<entry[\s>]/).slice(1)) {
      const title = limpa((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/) ?? [])[1] ?? "");
      const link = (chunk.match(/<link[^>]*href="([^"]+)"/) ?? [])[1];
      const tagline = limpa((chunk.match(/<content[^>]*>([\s\S]*?)<\/content>/) ?? [])[1] ?? "").slice(0, 200);
      if (title) {
        out.push({
          texto: `lançou hoje no Product Hunt: ${title}${tagline ? ` — ${tagline}` : ""}`,
          autor: "producthunt",
          url: link ?? "https://www.producthunt.com",
          metricas: "lançamento do dia",
        });
      }
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}
