"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { LangToggle, t, useLang } from "@/lib/i18n";

function UnlockForm() {
  const [lang, setLang] = useLang();
  const params = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      const next = params.get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="mb-6 flex items-center justify-between">
        <div className="btn-gradient h-10 w-10 rounded-xl" />
        <LangToggle lang={lang} setLang={setLang} />
      </div>
      <h1 className="text-2xl font-bold">Storyboard Studio Director</h1>
      <p className="mt-1 text-sm text-muted">{t(lang, "unlockTitle")}: {t(lang, "unlockSub")}</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="passcode">
          {t(lang, "passcode")}
        </label>
        <input
          id="passcode"
          type="password"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="rounded-xl border border-line bg-card px-3 py-2 outline-none focus:border-accent"
        />
        <button disabled={busy || !passcode} className="btn-gradient rounded-xl px-4 py-2.5 font-bold text-white">
          {t(lang, "unlock")}
        </button>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </form>
      <Link href="/showcase" className="mt-8 text-sm text-accent underline">
        {t(lang, "showcase")} →
      </Link>
    </main>
  );
}

export default function UnlockPage() {
  return (
    <Suspense fallback={null}>
      <UnlockForm />
    </Suspense>
  );
}
