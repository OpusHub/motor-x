import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { personalAccounts } from "@/lib/zernio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const config = await loadConfig();
  let accounts: { twitter: string | null; linkedin: string | null } = { twitter: null, linkedin: null };
  try {
    const a = await personalAccounts();
    accounts = {
      twitter: a.twitter ? a.twitter.displayName : null,
      linkedin: a.linkedin ? a.linkedin.displayName : null,
    };
  } catch {
    // Zernio fora do ar não derruba o dashboard
  }
  return NextResponse.json({ config, accounts });
}
