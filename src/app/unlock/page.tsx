"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { LangToggle, t, useLang } from "@/lib/i18n";

function UnlockForm() {
  const [lang, setLang] = useLang();
  const params = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/demo/unlock")
      .then((r) => r.json())
      .then((d: { contact?: string | null }) => setContact(d.contact ?? null))
      .catch(() => {});
  }, []);

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
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-6 flex items-center justify-between">
        <div className="btn-gradient h-10 w-10 rounded-xl" aria-hidden />
        <LangToggle lang={lang} setLang={setLang} />
      </div>
      <h1 className="text-3xl font-bold">Storyboard Studio Director</h1>
      <p className="mt-2 text-lg text-muted">{t(lang, "tagline")}</p>

      <Link
        href="/showcase"
        className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-accent/60 bg-accent/10 px-5 py-4 text-lg font-semibold text-ink transition hover:bg-accent/20"
      >
        <span>🎞 {t(lang, "noPasscodeNeeded")}</span>
        <span aria-hidden>→</span>
      </Link>

      <div className="mt-8 rounded-2xl border border-line bg-card p-5">
        <h2 className="text-lg font-bold">{t(lang, "unlockTitle")}</h2>
        <p className="mt-1 text-base text-muted">{t(lang, "unlockSub")}</p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          <label className="text-sm font-semibold text-muted" htmlFor="passcode">
            {t(lang, "passcode")}
          </label>
          <input
            id="passcode"
            type="password"
            autoComplete="off"
            autoFocus
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            className="rounded-xl border border-line bg-bg px-3 py-2.5 text-base outline-none focus:border-accent"
          />
          <button disabled={busy || !passcode} className="btn-gradient rounded-xl px-4 py-3 text-base font-bold text-white">
            {t(lang, "unlock")}
          </button>
          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
        </form>
      </div>
      {contact && (
        <p className="mt-6 text-sm text-muted">
          {t(lang, "contact")}:{" "}
          <a href={`mailto:${contact}`} className="text-violet-300 underline">
            {contact}
          </a>
        </p>
      )}
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
