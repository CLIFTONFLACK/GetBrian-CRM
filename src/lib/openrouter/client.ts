// Minimal OpenRouter chat-completions client. A web-search-capable model
// (Perplexity Sonar, or any model with the `:online` suffix) does the live web
// research and synthesis in a single call — this is the "AI plugin" that powers
// the company Deep Dive. Server-only (the key never reaches the browser).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * One chat completion.
 *
 * Takes either a single system+user pair (the Deep Dive report) or a whole
 * `messages` array (the follow-up Q&A, which has to carry the report and the
 * turns before it as context). `messages` wins when both are supplied.
 */
export async function openRouterChat({
  apiKey,
  model,
  system,
  user,
  messages,
}: {
  apiKey: string;
  model: string;
  system?: string;
  user?: string;
  messages?: OpenRouterMessage[];
}): Promise<string> {
  const turns: OpenRouterMessage[] = messages ?? [];
  if (!messages) {
    if (system) turns.push({ role: "system", content: system });
    if (user) turns.push({ role: "user", content: user });
  }
  if (turns.length === 0) throw new Error("No prompt supplied.");
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional attribution headers recommended by OpenRouter.
      // NB: header values must be Latin-1 (ASCII here) — no em dashes etc.
      "HTTP-Referer": "https://cdgleisure.com",
      "X-Title": "CDG CRM Deep Dive",
    },
    body: JSON.stringify({
      model,
      messages: turns,
    }),
    cache: "no-store",
    // The 10s this replaces was deliberate, not an oversight: it came from
    // docs/audit-handover-2026-07-02.md's S1, which added a blanket
    // AbortSignal.timeout(10_000) to all six external fetches to stop a hung
    // third party hanging the request until a platform 504. That intent is
    // preserved — 90s still aborts BELOW this route's 120s maxDuration, so a
    // stalled model surfaces as our labelled error, not a 504. Only the blanket
    // figure changed, because 10s was far too short for this one call site.
    //
    // A web-search model researches the company live — it reads several pages
    // before it writes a word, so 10s (the original value) aborted runs that
    // were working fine, and contradicted the UI's own "this can take up to a
    // minute". Kept below the calling route's maxDuration (120s on the company
    // page) so a slow model surfaces as our error, not a platform timeout.
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed (${res.status}). ${text.slice(0, 300)}`.trim(),
    );
  }

  let body: { choices?: { message?: { content?: string } }[] };
  try {
    body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
  } catch {
    throw new Error("OpenRouter returned invalid JSON.");
  }
  const content = body.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenRouter returned an empty response.");
  }
  return content.trim();
}
