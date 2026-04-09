import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getAllowedApproverEmails = () => {
  const rawApprovers =
    process.env.APPROVER_EMAILS ??
    process.env.APPROVER_EMAIL ??
    process.env.NEXT_PUBLIC_APPROVER_EMAILS ??
    process.env.NEXT_PUBLIC_APPROVER_EMAIL ??
    "";

  return rawApprovers
    .split(/[\n,;]+/)
    .map((value) => value.replace(/^['\"]|['\"]$/g, ""))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
};

export async function GET(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ isApprover: false }, { status: 200 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!accessToken) {
    return NextResponse.json({ isApprover: false }, { status: 200 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user?.email) {
    return NextResponse.json({ isApprover: false }, { status: 200 });
  }

  const approverEmails = getAllowedApproverEmails();
  const isApprover = approverEmails.includes(user.email.toLowerCase());

  return NextResponse.json({ isApprover }, { status: 200 });
}
