"use client";

import type {
  LocalImportResult,
  LocalLibrarySnapshot,
  LocalReleaseMutationResult,
  LocalRollbackResult,
  LocalTemplateLookupResult
} from "@/lib/local-library/types";

type ApiErrorPayload = {
  success?: false;
  error?: string;
};

export function isLocalStudioBrowser() {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text();
  let payload: T | ApiErrorPayload | null = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as T | ApiErrorPayload;
    } catch {
      throw new Error(
        responseText.trim().startsWith("<")
          ? "Local Studio API is unavailable. Run the project with npm run dev."
          : "Local Studio returned an invalid response."
      );
    }
  }

  if (!response.ok) {
    throw new Error((payload as ApiErrorPayload | null)?.error || "Local Studio request failed.");
  }

  return payload as T;
}

export async function getLocalLibraryClientSnapshot() {
  const response = await fetch("/api/local-library", {
    cache: "no-store"
  });
  const payload = await readApiResponse<{
    success: true;
    snapshot: LocalLibrarySnapshot;
  }>(response);
  return payload.snapshot;
}

export async function getLocalLibraryTemplate(
  slug: string,
  channel: "latest" | "published" = "published",
  includeRepository = false
) {
  const repositoryQuery = includeRepository ? "&repository=true" : "";
  const response = await fetch(
    `/api/local-library/${encodeURIComponent(slug)}?channel=${channel}${repositoryQuery}`,
    { cache: "no-store" }
  );
  const payload = await readApiResponse<{
    success: true;
    result: LocalTemplateLookupResult | null;
  }>(response);
  return payload.result;
}

export async function saveLocalLibraryRelease(formData: FormData) {
  const response = await fetch("/api/local-library", {
    method: "POST",
    body: formData
  });
  return readApiResponse<LocalReleaseMutationResult>(response);
}

export async function rollbackLocalLibraryProduct(slug: string, version: number) {
  const response = await fetch(
    `/api/local-library/${encodeURIComponent(slug)}/rollback`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ version })
    }
  );
  return readApiResponse<LocalRollbackResult>(response);
}

export async function importLocalLibraryProduct(file: File) {
  const formData = new FormData();
  formData.append("package", file);
  const response = await fetch("/api/local-library/import", {
    method: "POST",
    body: formData
  });
  return readApiResponse<LocalImportResult>(response);
}

export function getLocalProductExportUrl(slug: string, version?: number) {
  const query = version ? `?version=${version}` : "";
  return `/api/local-library/${encodeURIComponent(slug)}/export${query}`;
}
