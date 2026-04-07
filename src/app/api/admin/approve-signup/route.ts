import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type RequestBody = {
  requestId?: string;
  email?: string;
};

const hasMissingColumnError = (message: string | undefined, column: string) => {
  return (message ?? "").includes(`Could not find the '${column}' column`);
};

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

const ensureInviteCallbackPath = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      parsed.pathname = "/auth/callback";
      return parsed.toString().replace(/\/$/, "");
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return rawUrl.replace(/\/$/, "");
  }
};

const getInviteRedirectUrl = (request: Request) => {
  const configuredRedirect =
    process.env.SUPABASE_INVITE_REDIRECT_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;

  if (configuredRedirect?.trim()) {
    return ensureInviteCallbackPath(configuredRedirect.trim());
  }

  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelUrl?.trim()) {
    const host = vercelUrl.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    return ensureInviteCallbackPath(`https://${host}`);
  }

  const origin = request.headers.get("origin")?.trim();
  if (origin && !origin.includes("localhost")) {
    return ensureInviteCallbackPath(origin);
  }

  return undefined;
};

export async function POST(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "Supabase server environment variables are missing. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY), and SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 500 }
    );
  }

  const allowedApprovers = getAllowedApproverEmails();
  if (allowedApprovers.length === 0) {
    return NextResponse.json(
      {
        error:
          "APPROVER_EMAILS is not configured. Set APPROVER_EMAILS (or APPROVER_EMAIL) to one or more emails.",
      },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: requesterData, error: requesterError } = await userClient.auth.getUser(accessToken);
  if (requesterError || !requesterData.user) {
    return NextResponse.json({ error: "Unauthorized request." }, { status: 401 });
  }

  const requesterEmail = requesterData.user.email?.toLowerCase() ?? "";
  if (!allowedApprovers.includes(requesterEmail)) {
    return NextResponse.json({ error: "You are not allowed to approve requests." }, { status: 403 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requestId = body.requestId?.trim();
  let email = body.email?.trim().toLowerCase() ?? "";

  if (!requestId && !email) {
    return NextResponse.json({ error: "requestId or email is required." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (requestId) {
    const requestLookup = await adminClient
      .from("signup_requests")
      .select("email,status")
      .eq("id", requestId)
      .maybeSingle();

    if (!requestLookup.error && requestLookup.data?.email) {
      email = String(requestLookup.data.email).toLowerCase();
    }
  }

  if (!email) {
    return NextResponse.json({ error: "No email found for this request." }, { status: 400 });
  }

  const redirectTo = getInviteRedirectUrl(request);
  const inviteResult = await adminClient.auth.admin.inviteUserByEmail(
    email,
    redirectTo ? { redirectTo } : undefined
  );
  if (inviteResult.error) {
    return NextResponse.json(
      { error: `Unable to send invite email: ${inviteResult.error.message}` },
      { status: 502 }
    );
  }

  if (requestId) {
    const approvedAt = new Date().toISOString();
    const payloadAttempts = [
      { status: "approved", approved_at: approvedAt, approved_by: requesterEmail },
      { status: "approved", approved_at: approvedAt },
      { status: "approved" },
    ];

    for (const payload of payloadAttempts) {
      const updateResult = await adminClient.from("signup_requests").update(payload).eq("id", requestId);

      if (!updateResult.error) {
        break;
      }

      if (
        hasMissingColumnError(updateResult.error.message, "approved_by") ||
        hasMissingColumnError(updateResult.error.message, "approved_at") ||
        hasMissingColumnError(updateResult.error.message, "status")
      ) {
        continue;
      }

      break;
    }
  }

  return NextResponse.json({
    message: `Invite email sent to ${email}.`,
    redirectTo,
  });
}
