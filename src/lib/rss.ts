import { TrendItem } from "./types";

// Fonte de pesquisa SEM depender de créditos: manchetes de RSS de veículos
// reais. Entra como insumo de fato (MOV-07/11/29) quando o twitterapi está
// indisponível — fato com fonte nomeada, nunca inventado.

const FEEDS: { url: string; veiculo: string }[] = [
  { url: "https://techcrunch.com/feed/", veiculo: "TechCrunch" },
  { url: "https://hnrss.org/frontpage", veiculo: "Hacker News" },
  { url: "https://www.theverge.com/rss/index.xml", veiculo: "The Verge" },
];

function extract(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(
      m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]+>/g, "")
        .trim()
    );
  }
  return out;
}

export async function rssTrends(limit = 6): Promise<TrendItem[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(feed.url, {
          signal: controller.signal,
          cache: "no-store",
          headers: { "User-Agent": "Mozilla/5.0 (motor-x rss reader)" },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        // RSS usa <item><title>, Atom usa <entry><title>
        const items = xml.split(/<item[\s>]|<entry[\s>]/).slice(1, 5);
        const parsed: TrendItem[] = [];
        for (const chunk of items) {
          const title = extract(chunk, "title")[0] ?? "";
          const link = extract(chunk, "link")[0] || (chunk.match(/href="([^"]+)"/)?.[1] ?? "");
          if (title) parsed.push({ texto: title.slice(0, 200), autor: feed.veiculo, url: link });
        }
        return parsed;
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    })
  );
  // intercala os veículos pra variar
  const byFeed = results.map((r) => (r.status === "fulfilled" ? r.value : []));
  const out: TrendItem[] = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const list of byFeed) {
      const item = list[i];
      if (item) {
        out.push(item);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return out;
}
