import { mailtoHref } from "@/lib/contact-links";

/**
 * An email address as a mailto: link, or as plain text when the value is not
 * one plain address (see mailtoHref). Free text such as "a@b.co?bcc=x@y.com"
 * must never become a link that adds recipients.
 */
export function EmailLink({
  email,
  className,
}: {
  email: string;
  className?: string;
}) {
  const href = mailtoHref(email);
  if (!href) return <span className="break-all">{email}</span>;
  return (
    <a href={href} className={className}>
      {email}
    </a>
  );
}
