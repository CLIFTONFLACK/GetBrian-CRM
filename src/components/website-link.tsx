import { httpUrl } from "@/lib/contact-links";

/** A website as a link only when it is an absolute http: or https: URL. Anything
 *  else (javascript:, data:, a bare domain) shows as plain text, never as an href. */
export function WebsiteLink({ url, className }: { url: string; className?: string }) {
  const href = httpUrl(url);
  if (!href) return <span className="break-all">{url}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {url}
    </a>
  );
}
