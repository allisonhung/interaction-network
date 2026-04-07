import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header." },
        { status: 401 }
      );
    }

    const accessToken = authHeader.slice(7);

    // Verify token by fetching user info
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user?.email) {
      return NextResponse.json(
        { error: "Invalid or expired access token." },
        { status: 401 }
      );
    }

    // Check if user is in APPROVER_EMAILS
    const approverEmails = (process.env.APPROVER_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    if (!approverEmails.includes(user.email.toLowerCase())) {
      return NextResponse.json(
        { error: "You do not have permission to deny signup requests." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { requestId?: string }
      | null;
    const requestId = body?.requestId?.trim();

    if (!requestId) {
      return NextResponse.json(
        { error: "Missing or empty requestId in request body." },
        { status: 400 }
      );
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: "Missing SUPABASE_SERVICE_ROLE_KEY environment variable." },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Mark request as denied with status + timestamps
    const updates: Record<string, unknown> = { status: "denied" };

    // Try adding denied_at and denied_by if supported
    const { error: updateError } = await supabaseAdmin
      .from("signup_requests")
      .update({
        ...updates,
        denied_at: new Date().toISOString(),
        denied_by: user.email,
      })
      .eq("id", requestId);

    if (updateError) {
      // Fallback: try without timestamp/denied_by columns
      const { error: fallbackError } = await supabaseAdmin
        .from("signup_requests")
        .update(updates)
        .eq("id", requestId);

      if (fallbackError) {
        console.error("Error marking request as denied:", fallbackError.message);
        return NextResponse.json(
          { error: "Unable to mark request as denied in database." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { message: "Request denied successfully." },
      { status: 200 }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Error in deny-signup:", errorMessage);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
