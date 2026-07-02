import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { listJSON } from "@/lib/store";
import { RunState, ScheduledPost } from "@/lib/types";
import { todayBRT } from "@/pipeline/schedule";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const date = req.nextUrl.searchParams.get("date") ?? todayBRT();

  const [posts, runs] = await Promise.all([
    listJSON<ScheduledPost & { score?: number; runId?: string }>(`posts/${date}/`, 50),
    listJSON<RunState>(`runs/run-${date}`, 10),
  ]);

  const latestRun = runs
    .map((r) => r.data)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;

  return NextResponse.json({
    date,
    posts: posts.map((p) => p.data).sort((a, b) => a.scheduledForISO.localeCompare(b.scheduledForISO)),
    run: latestRun
      ? { id: latestRun.id, stage: latestRun.stage, error: latestRun.error, log: latestRun.log, mode: latestRun.mode }
      : null,
  });
}
