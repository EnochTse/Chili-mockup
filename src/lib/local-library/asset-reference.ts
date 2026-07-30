const localUploadScheme = "local-upload://";
const localBlobPrefix = "/api/local-library/assets/";

export type LocalUploadGroup =
  | "base"
  | "instruction"
  | "part-mask"
  | "finish-base"
  | "material-map"
  | "printing-area";

export function createLocalUploadReference(group: LocalUploadGroup, key: string) {
  return `${localUploadScheme}${group}/${encodeURIComponent(key)}`;
}

export function parseLocalUploadReference(reference: string) {
  if (!reference.startsWith(localUploadScheme)) return null;

  const value = reference.slice(localUploadScheme.length);
  const separatorIndex = value.indexOf("/");
  if (separatorIndex <= 0) return null;

  const group = value.slice(0, separatorIndex) as LocalUploadGroup;
  const encodedKey = value.slice(separatorIndex + 1);
  if (
    ![
      "base",
      "instruction",
      "part-mask",
      "finish-base",
      "material-map",
      "printing-area"
    ].includes(group) ||
    !encodedKey
  ) {
    return null;
  }

  try {
    return {
      group,
      key: decodeURIComponent(encodedKey)
    };
  } catch {
    return null;
  }
}

export function getLocalUploadFormField(reference: string) {
  return `localAsset:${encodeURIComponent(reference)}`;
}

export function toLocalBlobReference(blobName: string) {
  return `${localBlobPrefix}${encodeURIComponent(blobName)}`;
}

export function parseLocalBlobReference(reference: string) {
  let pathname = reference;

  try {
    if (/^https?:\/\//i.test(reference)) {
      pathname = new URL(reference).pathname;
    }
  } catch {
    return null;
  }

  if (!pathname.startsWith(localBlobPrefix)) return null;

  try {
    const blobName = decodeURIComponent(pathname.slice(localBlobPrefix.length));
    return /^[a-f0-9]{64}\.(?:png|jpe?g|webp)$/i.test(blobName) ? blobName : null;
  } catch {
    return null;
  }
}
