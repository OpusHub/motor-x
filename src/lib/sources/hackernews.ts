import { TrendItem } from "../types";

// Hacker News via API pública do Algolia — JSON limpo, sem chave, funciona de
// IP de datacenter. Front page + o comentário top das 2 maiores: a "conversa"
// que o pauteiro comenta, não só a manchete.

interface HNHit {
  objectID: string;
  title: string;
  points: number;
  num_comments: number;
}

function limpaHTML(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

export async function hnSignal(limit = 4): Promise<TrendItem[]> {
  try {
    const res = await fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15", {
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { hits: HNHit[] };
    const hits = data.hits
      .filter((h) => h.title && h.points > 40)
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);

    const out: TrendItem[] = [];
    for (const [i, h] of hits.entries()) {
      let comentario = "";
      if (i < 2 && h.num_comments > 5) {
        try {
          const c = await fetch(
            `https://hn.algolia.com/api/v1/search?tags=comment,story_${h.objectID}&hitsPerPage=1`,
            { cache: "no-store", signal: AbortSignal.timeout(6000) }
          );
          const cd = (await c.json()) as { hits: { comment_text?: string }[] };
          const txt = limpaHTML(cd.hits[0]?.comment_text ?? "");
          if (txt) comentario = ` | comentário top da thread: "${txt.slice(0, 180)}"`;
        } catch {
          // sem comentário, segue só com o título
        }
      }
      out.push({
        texto: `${h.title}${comentario}`,
        autor: "hackernews",
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        metricas: `${h.points} pts, ${h.num_comments} comentários`,
      });
    }
    return out;
  } catch {
    return [];
  }
}
