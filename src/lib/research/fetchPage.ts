/** Fetch a few result pages so snippets are real excerpts, not SERP crumbs. */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type PageExcerpt = {
  title?: string;
  text: string;
};

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchPageExcerpt(
  url: string,
  timeoutMs = 5_000,
): Promise<PageExcerpt | null> {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (/youtube\.com|youtu\.be/i.test(host)) return null;
    if (/\.pdf(\?|$)/i.test(url)) return null;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !/html|xml|text\/plain/i.test(type)) return null;
    const html = (await res.text()).slice(0, 80_000);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    const text = stripTags(html).slice(0, 2_000);
    if (text.length < 80) return null;
    return { title: title ? stripTags(title).slice(0, 220) : undefined, text };
  } catch {
    return null;
  }
}
