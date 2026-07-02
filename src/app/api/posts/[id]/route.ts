import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { getJSON, putJSON } from "@/lib/store";
import { ScheduledPost } from "@/lib/types";
import { deletePost, updatePostContent } from "@/lib/zernio";

export const dynamic = "force-dynamic";

type StoredPost = ScheduledPost & { runId?: string; score?: number };

async function loadPost(date: string, pautaId: string): Promise<StoredPost | null> {
  return getJSON<StoredPost>(`posts/${date}/${pautaId}.json`);
}

// PATCH: edita o texto (no Blob e na Zernio). Body: { date, texto }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { date, texto } = (await req.json().catch(() => ({}))) as { date?: string; texto?: string };
  if (!date || !texto) return NextResponse.json({ error: "date e texto obrigatórios" }, { status: 400 });

  const post = await loadPost(date, id);
  if (!post) return NextResponse.json({ error: "post não encontrado" }, { status: 404 });

  if (post.zernioPostId) {
    try {
      await updatePostContent(post.zernioPostId, texto);
    } catch (err) {
      return NextResponse.json(
        { error: `Zernio: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 }
      );
    }
  }
  const updated = { ...post, texto };
  await putJSON(`posts/${date}/${id}.json`, updated);
  return NextResponse.json({ post: updated });
}

// DELETE: mata o post (remove da Zernio, marca como killed). Body: { date }
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { date } = (await req.json().catch(() => ({}))) as { date?: string };
  if (!date) return NextResponse.json({ error: "date obrigatório" }, { status: 400 });

  const post = await loadPost(date, id);
  if (!post) return NextResponse.json({ error: "post não encontrado" }, { status: 404 });

  if (post.zernioPostId) {
    try {
      await deletePost(post.zernioPostId);
    } catch {
      // já publicado/inexistente na Zernio — segue marcando como killed localmente
    }
  }
  const updated = { ...post, status: "killed" as const };
  await putJSON(`posts/${date}/${id}.json`, updated);
  return NextResponse.json({ post: updated });
}
