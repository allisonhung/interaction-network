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
  return (process.env.APPROVER_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
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
      { error: "APPROVER_EMAILS is not configured." },
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

  const inviteResult = await adminClient.auth.admin.inviteUserByEmail(email);
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
  });
}
