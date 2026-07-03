import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isDashboardAuthed } from "@/lib/auth";
import { getJSON, putBinary, putJSON } from "@/lib/store";
import { InboxItem } from "@/lib/types";
import { todayBRT } from "@/pipeline/schedule";

export const dynamic = "force-dynamic";

const MAX_IMG_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function normalize(raw: (string | InboxItem)[]): InboxItem[] {
  return raw.map((it, i) =>
    typeof it === "string" ? { id: `m${i + 1}`, texto: it } : { ...it, id: it.id ?? `m${i + 1}` }
  );
}

// Inbox de ideias — aceita JSON {texto} ou multipart (texto + imagem).
// Print + contexto vira pauta prioritária: o modelo lê a imagem no gather e o
// post sai com ela anexada.
export async function POST(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let texto = "";
  let mediaUrl: string | undefined;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "form inválido" }, { status: 400 });
    texto = String(form.get("texto") ?? "").trim();
    const file = form.get("imagem");
    if (file instanceof File && file.size > 0) {
      const ext = EXT[file.type];
      if (!ext) return NextResponse.json({ error: "imagem precisa ser jpg/png/webp/gif" }, { status: 400 });
      if (file.size > MAX_IMG_BYTES) return NextResponse.json({ error: "imagem acima de 8MB" }, { status: 400 });
      mediaUrl = await putBinary(`media/${todayBRT()}/${randomUUID()}.${ext}`, await file.arrayBuffer(), file.type);
    }
  } else {
    const body = (await req.json().catch(() => ({}))) as { texto?: string };
    texto = (body.texto ?? "").trim();
  }

  if (!texto && !mediaUrl) return NextResponse.json({ error: "manda um texto ou uma imagem" }, { status: 400 });

  const date = todayBRT();
  const path = `inbox/${date}.json`;
  const items = normalize((await getJSON<(string | InboxItem)[]>(path)) ?? []);
  items.push({
    id: `w${items.length + 1}-${randomUUID().slice(0, 4)}`,
    texto: texto || "(print sem contexto — extraia o fato da imagem)",
    mediaUrl,
  });
  await putJSON(path, items);
  return NextResponse.json({ ok: true, count: items.length, mediaUrl });
}

export async function GET(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const date = req.nextUrl.searchParams.get("date") ?? todayBRT();
  const items = normalize((await getJSON<(string | InboxItem)[]>(`inbox/${date}.json`)) ?? []);
  return NextResponse.json({ date, items });
}
