"use client";

import { Mail, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logDealShare } from "@/lib/actions/activities";

/**
 * Share a deal update by email or WhatsApp (#11). Composes a plain-text update
 * (title, stage, value, link) and opens the mail / WhatsApp composer, logging
 * the share as a deal activity.
 */
export function DealShareActions({
  dealId,
  title,
  stage,
  value,
}: {
  dealId: string;
  title: string;
  stage: string;
  value: number | null;
}) {
  function message() {
    const url = window.location.href;
    return [
      `Deal update: ${title}`,
      `Stage: ${stage}`,
      value != null ? `Value: £${value.toLocaleString("en-GB")}` : undefined,
      "",
      url,
    ]
      .filter((l) => l !== undefined)
      .join("\n");
  }

  // Await the activity log BEFORE opening the composer — a mailto navigation
  // can cancel an in-flight request, silently dropping the share record.
  async function log(channel: string) {
    const fd = new FormData();
    fd.set("deal_id", dealId);
    fd.set("channel", channel);
    try {
      await logDealShare({}, fd);
    } catch {
      // Best-effort — never block the share itself on logging.
    }
  }

  async function email() {
    await log("email");
    const subject = encodeURIComponent(`Deal update: ${title}`);
    const body = encodeURIComponent(message());
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  async function whatsapp() {
    await log("WhatsApp");
    window.open(`https://wa.me/?text=${encodeURIComponent(message())}`, "_blank", "noopener");
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={email}>
        <Mail />
        Email update
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={whatsapp}>
        <MessageCircle />
        WhatsApp
      </Button>
    </>
  );
}
