import { put, list } from "@vercel/blob";

// Armazenamento JSON sobre Vercel Blob.
// - Paths prefixados com BLOB_PATH_SECRET: o store é público, o segredo no path
//   impede leitura por URL adivinhável.
// - Leituras com cache-bust (query única): o edge cache do Blob segura conteúdo
//   stale por ~60s, o que quebraria o handoff da chain (ler o run recém-salvo).

function prefix(path: string): string {
  const secret = process.env.BLOB_PATH_SECRET;
  return secret ? `${secret}/${path}` : path;
}

export async function putJSON(path: string, data: unknown): Promise<void> {
  await put(prefix(path), JSON.stringify(data, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60, // mínimo permitido; leituras fazem cache-bust
  });
}

async function fetchFresh<T>(url: string): Promise<T | null> {
  const bust = `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(bust, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function getJSON<T>(path: string): Promise<T | null> {
  const full = prefix(path);
  const { blobs } = await list({ prefix: full, limit: 1 });
  const blob = blobs.find((b) => b.pathname === full);
  if (!blob) return null;
  return fetchFresh<T>(blob.url);
}

export async function listJSON<T>(pathPrefix: string, limit = 100): Promise<{ path: string; data: T }[]> {
  const secret = process.env.BLOB_PATH_SECRET;
  const { blobs } = await list({ prefix: prefix(pathPrefix), limit });
  const out: { path: string; data: T }[] = [];
  await Promise.all(
    blobs.map(async (b) => {
      try {
        const data = await fetchFresh<T>(b.url);
        if (data !== null) {
          const cleanPath = secret ? b.pathname.replace(`${secret}/`, "") : b.pathname;
          out.push({ path: cleanPath, data });
        }
      } catch {
        // arquivo corrompido não derruba a listagem
      }
    })
  );
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
