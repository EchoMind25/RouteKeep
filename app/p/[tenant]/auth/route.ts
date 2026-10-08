import { NextResponse } from "next/server";
import { redeemSignInLink } from "@/lib/portal/data";
import { portalCookie } from "@/lib/portal/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-POR-01: opening the emailed link signs the customer in, once.
export async function GET(request: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!UUID.test(tenant)) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const customer = token.length >= 32 ? await redeemSignInLink(tenant, token) : null;
  // Relative locations: behind a proxy, request.url can name a host the browser never used.
  if (!customer) return new NextResponse(null, { status: 303, headers: { Location: `/p/${tenant}?expired=1`, "Referrer-Policy": "no-referrer" } });
  const response = new NextResponse(null, { status: 303, headers: { Location: `/p/${tenant}`, "Referrer-Policy": "no-referrer" } });
  const cookie = portalCookie(tenant, customer);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
