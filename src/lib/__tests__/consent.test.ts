import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  GA_MEASUREMENT_ID,
  clearGaCookies,
  gaInitScript,
  isExcludedPath,
  isGaCookieName,
  isTrackedHost,
  isTrackedPath,
  parseConsent,
  showsBanner,
} from "../consent.ts";

test("tracks crm.getbrian.xyz and nothing else, including lookalikes and sibling sites", () => {
  assert.equal(isTrackedHost("crm.getbrian.xyz"), true);
  assert.equal(isTrackedHost("CRM.GetBrian.XYZ"), true);
  for (const h of [
    "getbrian.xyz",
    "www.getbrian.xyz",
    "dealmaker.getbrian.xyz",
    "x.crm.getbrian.xyz",
    "crm.getbrian.xyz.evil.com",
    "notcrm.getbrian.xyz",
    "crm.getbrian.xyzz",
    "crm.cliftonai.co",
    "getbrian-crm-git-x.vercel.app",
    "localhost",
    "",
  ]) {
    assert.equal(isTrackedHost(h), false, h);
  }
});

test("the banner shows on the tracked host and localhost only", () => {
  assert.equal(showsBanner("crm.getbrian.xyz"), true);
  assert.equal(showsBanner("localhost"), true);
  assert.equal(showsBanner("127.0.0.1"), true);
  assert.equal(showsBanner("getbrian.xyz"), false);
  assert.equal(showsBanner("getbrian-crm-git-x.vercel.app"), false);
});

test("only the marketing page and the public requirement form are measured", () => {
  for (const p of ["/", "/submit-requirement", "/submit-requirement/thank-you"]) {
    assert.equal(isTrackedPath(p), true, p);
    assert.equal(isExcludedPath(p), false, p);
  }
  // The signed-in CRM, sign-in, API and lookalikes never load the tag or show the banner.
  for (const p of [
    "/login",
    "/sign-up",
    "/dashboard",
    "/deals",
    "/deals/123",
    "/contacts",
    "/companies",
    "/kyc",
    "/admin",
    "/api/auth/session",
    "/submit-requirements",
    "/submit-requirement-x",
    "//evil",
    "",
  ]) {
    assert.equal(isTrackedPath(p), false, p);
    assert.equal(isExcludedPath(p), true, p);
  }
});

test("only an exact stored choice counts; anything else means 'not asked'", () => {
  assert.equal(parseConsent("granted"), "granted");
  assert.equal(parseConsent("denied"), "denied");
  for (const v of [null, undefined, "", "true", "GRANTED", "granted ", "1"]) {
    assert.equal(parseConsent(v as string | null | undefined), null, String(v));
  }
});

test("the init script sets consent v2 signals before config and denies the ad signals", () => {
  const s = gaInitScript();
  assert.ok(s.indexOf("'consent','default'") < s.indexOf("'config'"));
  assert.match(s, /analytics_storage:'granted'/);
  for (const sig of ["ad_storage", "ad_user_data", "ad_personalization"]) {
    assert.match(s, new RegExp(`${sig}:'denied'`));
  }
  assert.ok(s.includes(`gtag('config','${GA_MEASUREMENT_ID}',{page_location:`));
  assert.match(s, /allow_google_signals:false/);
  assert.equal(GA_MEASUREMENT_ID, "G-DH8FGLMYQ0");
  assert.ok(!s.includes("= true"), "must not leave the disable flag on");
});

test("recognises gtag cookie names and no others", () => {
  for (const n of ["_ga", "_ga_DH8FGLMYQ0", "_gid", "_gat", "_gat_gtag_G_DH8FGLMYQ0"]) {
    assert.equal(isGaCookieName(n), true, n);
  }
  for (const n of ["gb_consent", "session", "_gaps", "ga", "x_ga", "authjs.session-token"]) {
    assert.equal(isGaCookieName(n), false, n);
  }
});

test("clearGaCookies expires GA cookies and leaves the sign-in session and other cookies alone", () => {
  const writes: string[] = [];
  const doc = {
    get cookie() {
      return "_ga=GA1.1.1; _ga_DH8FGLMYQ0=GS1; authjs.session-token=secret; gb_consent=granted";
    },
    set cookie(v: string) {
      writes.push(v);
    },
  } as unknown as Document;
  clearGaCookies(doc, "crm.getbrian.xyz");
  const names = new Set(writes.map((w) => w.split("=")[0]));
  assert.deepEqual([...names].sort(), ["_ga", "_ga_DH8FGLMYQ0"]);
  assert.ok(writes.every((w) => w.includes("expires=Thu, 01 Jan 1970")));
  assert.ok(writes.some((w) => w.includes("domain=.getbrian.xyz")), "parent domain covered");
});

test("with storage blocked, a choice still holds for the page view and nothing is assumed before it", async () => {
  const { readConsent, writeConsent, resetMemoryChoiceForTests } = await import("../consent.ts");
  const events: string[] = [];
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: blocked,
    dispatchEvent: (e: Event) => events.push(e.type),
  };
  try {
    resetMemoryChoiceForTests();
    assert.equal(readConsent(), null, "no choice yet means not asked");
    writeConsent("denied");
    assert.equal(readConsent(), "denied");
    writeConsent("granted");
    assert.equal(readConsent(), "granted");
    assert.equal(events.length, 2);
  } finally {
    resetMemoryChoiceForTests();
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

function runInit(href: string, referrer: string) {
  const ctx: Record<string, unknown> = {
    location: { href, origin: new URL(href).origin },
    document: { referrer },
    URL,
    Array,
    Date,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(gaInitScript(), ctx);
  const layer = (ctx.dataLayer as ArrayLike<unknown>[]).map((a) => Array.from(a));
  return JSON.parse(JSON.stringify(layer.find((a) => a[0] === "config")));
}

test("the init script sends a clean address: no query (except utm_*), no fragment", () => {
  const cfg = runInit("https://crm.getbrian.xyz/submit-requirement?token=SECRET&utm_source=mail#frag", "");
  assert.equal(cfg[1], "G-DH8FGLMYQ0");
  assert.equal(cfg[2].page_location, "https://crm.getbrian.xyz/submit-requirement?utm_source=mail");
  assert.equal(cfg[2].allow_google_signals, false);
  assert.equal(cfg[2].allow_ad_personalization_signals, false);
});

test("the init script blanks same-site referrers and trims external ones", () => {
  const same = runInit("https://crm.getbrian.xyz/", "https://crm.getbrian.xyz/deals/12?x=1");
  assert.equal(same[2].page_referrer, "");
  const ext = runInit("https://crm.getbrian.xyz/", "https://news.example.org/story?token=abc#x");
  assert.equal(ext[2].page_referrer, "https://news.example.org/story");
  const none = runInit("https://crm.getbrian.xyz/", "");
  assert.equal(none[2].page_referrer, "");
});

test("the cookie cleanup matches the real GA names only, not lookalikes", () => {
  for (const n of ["_gatekeeper", "_gatx", "_gaps"]) assert.equal(isGaCookieName(n), false, n);
  assert.equal(isGaCookieName("_gat"), true);
  assert.equal(isGaCookieName("_gat_gtag_G_DH8FGLMYQ0"), true);
});
