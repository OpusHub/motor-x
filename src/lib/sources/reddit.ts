import { TrendItem } from "../types";

// Fonte GRÁTIS e segura: Reddit via RSS (Atom). O JSON do Reddit é bloqueado
// pra IP de datacenter, mas o RSS passa. Puxa discussões QUENTES de subs do
// nicho founder/SaaS/marketing — dor real, rant real, pergunta real: o
// combustível certo pra take ácido/contrário do Victor (não manchete genérica).

const SUBS = [
  { sub: "SaaS", tag: "SaaS" },
  { sub: "Entrepreneur", tag: "empreendedorismo" },
  { sub: "startups", tag: "startups" },
  { sub: "marketing", tag: "marketing" },
  { sub: "SideProject", tag: "side project" },
  { sub: "indiehackers", tag: "indie hacker" },
  { sub: "artificial", tag: "IA" },
];

interface RedditEntry {
  title: string;
  content: string;
  link: string;
  sub: string;
}

function unescape(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// sorteio determinístico: mesmo dia = mesmos subs (idempotência entre retries),
// dias diferentes = mix diferente (variedade de assunto ao longo da semana)
function seedPick<T>(arr: T[], n: number, seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

async function fetchSub(sub: string, tag: string): Promise<RedditEntry[]> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (tentativa > 0) await new Promise((r) => setTimeout(r, 1500));
    const out = await fetchSubOnce(sub, tag);
    if (out.length > 0) return out;
  }
  return [];
}

async function fetchSubOnce(sub: string, tag: string): Promise<RedditEntry[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    // hot = o que está bombando agora
    const res = await fetch(`https://www.reddit.com/r/${sub}/hot.rss?limit=10`, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; motorx-content/1.0)",
        Accept: "application/atom+xml, application/xml",
      },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const entries: RedditEntry[] = [];
    for (const chunk of xml.split(/<entry[\s>]/).slice(1)) {
      const title = unescape((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/) ?? [])[1] ?? "");
      const content = unescape((chunk.match(/<content[^>]*>([\s\S]*?)<\/content>/) ?? [])[1] ?? "").slice(0, 400);
      const link = (chunk.match(/<link[^>]*href="([^"]+)"/) ?? [])[1] ?? "";
      // ignora posts de regra/meta/anúncio do próprio sub
      if (title && !/^(rule|mod|weekly|monthly|megathread|read this)/i.test(title)) {
        entries.push({ title, content, link, sub: tag });
      }
    }
    return entries.slice(0, 5);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function redditSignal(limit = 8, seed = "hoje"): Promise<TrendItem[]> {
  // Reddit rate-limita rajada de IP anônimo: 7 fetches paralelos = só 1 sub
  // sobrevive (visto em produção: 5/5 sinais do mesmo sub → drafts repetidos).
  // Sequencial com respiro + 4 subs sorteados por dia.
  const picked = seedPick(SUBS, 4, seed);
  const bySub: RedditEntry[][] = [];
  for (const s of picked) {
    bySub.push(await fetchSub(s.sub, s.tag));
    await new Promise((r) => setTimeout(r, 700));
  }
  // intercala os subs pra variar o assunto
  const out: TrendItem[] = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const list of bySub) {
      const e = list[i];
      if (e) {
        out.push({
          texto: e.content ? `${e.title} — ${e.content}`.slice(0, 300) : e.title,
          autor: `r/${e.sub}`,
          url: e.link,
          metricas: "discussão quente no reddit",
        });
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return out;
}
