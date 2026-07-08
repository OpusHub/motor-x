import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { getJSON, putJSON } from "@/lib/store";
import { ScheduledPost } from "@/lib/types";

export const dynamic = "force-dynamic";

// O julgamento do Victor no painel vira LIÇÃO permanente do motor: 👍 marca o
// padrão como alvo, 👎 marca como veto. É o canal dele "me dar mais dele"
// sem depender de sessão de chat.
export async function POST(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as
    | { date?: string; pautaId?: string; veredito?: "gostei" | "nao_sou_eu" }
    | null;
  if (!body?.date || !body.pautaId || !["gostei", "nao_sou_eu"].includes(body.veredito ?? "")) {
    return NextResponse.json({ error: "date, pautaId e veredito (gostei|nao_sou_eu) obrigatórios" }, { status: 400 });
  }
  const path = `posts/${body.date}/${body.pautaId}.json`;
  const post = await getJSON<ScheduledPost & { texto?: string; feedback?: string }>(path);
  if (!post) return NextResponse.json({ error: "post não encontrado" }, { status: 404 });

  const trecho = (post.texto ?? "").replace(/\n/g, " / ").slice(0, 90);
  const licao =
    body.veredito === "gostei"
      ? `APROVADO pelo Victor no painel: "${trecho}" — esse padrão de forma+tom é o alvo, repita o jeito (não as palavras)`
      : `VETADO pelo Victor no painel ("não sou eu"): "${trecho}" — não repetir esse jeito de escrever`;

  const blob = (await getJSON<{ lessons: { d: string; t: string }[] }>("lessons.json")) ?? { lessons: [] };
  blob.lessons.push({ d: body.date, t: licao });
  blob.lessons = blob.lessons.slice(-40);
  await putJSON("lessons.json", blob);
  await putJSON(path, { ...post, feedback: body.veredito });

  return NextResponse.json({ ok: true, feedback: body.veredito });
}
