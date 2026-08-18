import { checkXenaHealth } from "@/lib/clawbio/xena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const health = await checkXenaHealth();
  return Response.json(health, {
    status: health.status === "online" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
