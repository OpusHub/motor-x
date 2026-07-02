import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, isValidSessionValue } from "@/lib/auth";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const store = await cookies();
  if (!isValidSessionValue(store.get(COOKIE_NAME)?.value)) redirect("/login");
  return <DashboardClient />;
}
