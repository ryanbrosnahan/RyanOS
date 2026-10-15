/** Select the mailbox independently of the browser's Google account order. */
export function gmailThreadUrl(threadId: string, mailbox?: string): string {
  const accountQuery = mailbox ? `?authuser=${encodeURIComponent(mailbox)}` : "";
  return `https://mail.google.com/mail/u/0/${accountQuery}#all/${encodeURIComponent(threadId)}`;
}

/** Repair the email-address account path used by older stored sources. */
export function normalizeGmailUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== "https://mail.google.com") return value;
    const match = /^\/mail\/u\/([^/]+)\/$/.exec(url.pathname);
    if (!match) return value;
    const mailbox = decodeURIComponent(match[1]!);
    if (!mailbox.includes("@")) return value;
    url.pathname = "/mail/u/0/";
    url.searchParams.set("authuser", mailbox);
    url.hash = url.hash.replace(/^#inbox\//, "#all/");
    return url.toString();
  } catch {
    return value;
  }
}

/** Existing tasks contain a copy of the source URL in their Markdown body. */
export function normalizeGmailLinksInText(value: string): string {
  return value.replace(/https:\/\/mail\.google\.com\/[^\s)<>\[\]]+/g, normalizeGmailUrl);
}
