/**
 * web/exportText.ts – copying text to the clipboard and downloading it as a file.
 * Browser-only. Nothing here reads or writes anything but the text it is given.
 */

/**
 * Copies text to the clipboard. Resolves to true when it worked.
 * `navigator.clipboard` only exists on secure pages (https or localhost), so a phone that opens the LAN address
 * would have nothing; the older copy command is the fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (permission, or not a secure page): try the fallback.
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(box);
    return copied;
  } catch {
    return false;
  }
}

/** Downloads text as a file with this name. */
export function downloadText(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  requestAnimationFrame(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}
