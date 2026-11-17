import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export class CaptureError extends Error {
  constructor(public code: string, public retryable = false) { super(code); }
}
export function normalizeInstagramUrl(value: string): { shortcode: string; url: string } {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new CaptureError("invalid_instagram_url"); }
  if (url.protocol !== "https:" || !["instagram.com","www.instagram.com","m.instagram.com"].includes(url.hostname) || url.username || url.password || url.port) throw new CaptureError("invalid_instagram_url");
  const match = url.pathname.match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,64})\/?$/);
  if (!match) throw new CaptureError("unsupported_instagram_link");
  return { shortcode: match[1]!, url: `https://www.instagram.com/p/${match[1]!}/` };
}
export function allowedDownloadUrl(value: string, media: boolean): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new CaptureError("unsafe_media_url"); }
  const host = url.hostname.toLowerCase();
  const allowed = media ? host.endsWith(".cdninstagram.com") || host.endsWith(".fbcdn.net") : host === "www.instagram.com" || host === "instagram.com";
  if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password) throw new CaptureError("unsafe_media_url");
  return url;
}
export function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number) as [number,number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
}
async function resolvePinned(hostname: string, signal: AbortSignal) {
  if (signal.aborted) throw new CaptureError('download_timeout',true);
  let listener: () => void = () => {};
  const aborted = new Promise<never>((_resolve,reject) => { listener = () => reject(new CaptureError('download_timeout',true)); signal.addEventListener('abort',listener,{once:true}); });
  try { return await Promise.race([lookup(hostname,{family:4,all:true}),aborted]); }
  finally { signal.removeEventListener('abort',listener); }
}
export type Download = (url: string, media: boolean, limit: number, signal: AbortSignal) => Promise<{ bytes: Buffer; contentType: string }>;
export const download: Download = async (value, media, limit, signal) => {
  for (let redirects = 0; redirects <= 3; redirects++) {
    const url = allowedDownloadUrl(value, media);
    const addresses = await resolvePinned(url.hostname,signal);
    if (!addresses.length || addresses.some(entry => !publicIPv4(entry.address))) throw new CaptureError("unsafe_network_address");
    // Pin the validated address; TLS still verifies the original hostname.
    const result = await new Promise<{ bytes: Buffer; contentType: string; redirect?: string }>((resolve,reject) => {
      const req = request(url, { signal, method: "GET", headers: { "user-agent": "RyanOS/1.0 public-link-capture", accept: media ? "video/*,image/*" : "text/html" }, lookup: (_hostname, _options, callback) => callback(null, addresses[0]!.address, 4) }, res => {
        const status = res.statusCode ?? 0;
        if ([301,302,303,307,308].includes(status)) {
          res.destroy();
          if (!res.headers.location) return reject(new CaptureError("invalid_redirect"));
          return resolve({ bytes: Buffer.alloc(0), contentType: "", redirect: new URL(res.headers.location,url).href });
        }
        if (status !== 200) { res.destroy(); return reject(new CaptureError(status === 429 ? "instagram_throttled" : [401,403].includes(status) ? "login_or_access_blocked" : "source_unavailable", status === 429 || status >= 500)); }
        const contentType = String(res.headers["content-type"] ?? "").split(';')[0]!;
        if ((media && !/^(video\/mp4|image\/(jpeg|png|webp))$/.test(contentType)) || (!media && contentType !== 'text/html')) { res.destroy(); return reject(new CaptureError("unexpected_content_type")); }
        if (Number(res.headers['content-length']) > limit) { res.destroy(); return reject(new CaptureError("download_size_limit")); }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > limit) { res.destroy(new CaptureError("download_size_limit")); } else chunks.push(chunk); });
        res.on('error', reject); res.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType }));
      });
      req.setTimeout(15_000, () => req.destroy(new CaptureError("download_timeout", true)));
      req.on('error', reject); req.end();
    });
    if (!result.redirect) return result;
    value = result.redirect;
  }
  throw new CaptureError("too_many_redirects");
};
