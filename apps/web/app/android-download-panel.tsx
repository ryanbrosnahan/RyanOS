"use client";

import { Download, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

type AndroidManifest = {
  versionCode?: number;
  versionName?: string;
  apkUrl?: string;
  publishedAt?: string;
};

export function AndroidDownloadPanel() {
  const [manifest, setManifest] = useState<AndroidManifest | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/downloads/android/manifest.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        setManifest(data);
        setAvailable(Boolean(data?.apkUrl));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const apkUrl = manifest?.apkUrl ?? "/downloads/android/ryanos-latest.apk";

  return (
    <div className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Smartphone className="h-5 w-5 text-sky-700" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-stone-950">Android app</h2>
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <div className="text-sm text-stone-700">
          {available ? (
            <span>
              {manifest?.versionName
                ? `Version ${manifest.versionName} (${manifest.versionCode ?? "latest"})`
                : "Latest APK"}
            </span>
          ) : (
            <span>APK not published yet</span>
          )}
        </div>
        {available ? (
          <a
            href={apkUrl}
            className="inline-flex h-9 items-center justify-center rounded-md bg-stone-950 px-3 text-sm font-medium text-white hover:bg-stone-800"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Download APK
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex h-9 items-center justify-center rounded-md bg-stone-300 px-3 text-sm font-medium text-stone-600"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Download APK
          </button>
        )}
      </div>
    </div>
  );
}
