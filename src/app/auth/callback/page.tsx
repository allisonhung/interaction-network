"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [statusText, setStatusText] = useState("Finishing invite sign-in...");

  useEffect(() => {
    let active = true;

    const finish = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (error) {
        setStatusText(error.message);
        return;
      }

      if (session) {
        setStatusText("Invite accepted. Redirecting...");
        window.setTimeout(() => {
          router.replace("/");
        }, 500);
        return;
      }

      const hash = window.location.hash ?? "";
      const hasAuthTokens = hash.includes("access_token") || hash.includes("refresh_token");

      if (!hasAuthTokens) {
        setStatusText("This invite link is invalid or has already been used.");
        return;
      }

      setStatusText("Processing invite token...");

      window.setTimeout(async () => {
        if (!active) {
          return;
        }

        const {
          data: { session: delayedSession },
          error: delayedError,
        } = await supabase.auth.getSession();

        if (!active) {
          return;
        }

        if (delayedError) {
          setStatusText(delayedError.message);
          return;
        }

        if (delayedSession) {
          setStatusText("Invite accepted. Redirecting...");
          window.setTimeout(() => {
            router.replace("/");
          }, 500);
          return;
        }

        setStatusText("Unable to complete invite sign-in. Please request a new invite.");
      }, 800);
    };

    void finish();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-800">Invite Confirmation</h1>
        <p className="mt-2 text-sm text-slate-600">{statusText}</p>
      </div>
    </main>
  );
}
