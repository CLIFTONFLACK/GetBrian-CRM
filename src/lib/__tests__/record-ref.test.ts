import test from "node:test";
import assert from "node:assert/strict";
import {
  closeRecordHref,
  fullRecordHref,
  openRecordHref,
  parseRecordRef,
  PANEL_HOST_PATHS,
  parseTab,
  RECORD_TABS,
  tabHref,
} from "../record-ref.ts";

const ID = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";

test("parseRecordRef accepts the five known types with a uuid", () => {
  for (const type of ["company", "contact", "requirement", "listing", "deal"]) {
    assert.deepEqual(parseRecordRef(`${type}:${ID}`), { type, id: ID });
  }
});

test("parseRecordRef lowercases the id", () => {
  assert.deepEqual(parseRecordRef(`company:${ID.toUpperCase()}`), {
    type: "company",
    id: ID,
  });
});

test("parseRecordRef rejects anything that is not type:uuid", () => {
  const bad: unknown[] = [
    undefined,
    null,
    "",
    ["company:" + ID],
    42,
    `disposal:${ID}`,
    `Listing:${ID}`,
    `Company:${ID}`,
    `company:${ID}:extra`,
    `company:${ID} `,
    ` company:${ID}`,
    "company:",
    "company:123",
    "company:not-a-uuid-at-all-not-a-uuid-at-all!",
    `company:${ID}'; drop table companies;--`,
    `company:${ID.replace("3f2b", "zzzz")}`,
    `constructor:${ID}`,
    `__proto__:${ID}`,
    ID,
  ];
  for (const raw of bad) assert.equal(parseRecordRef(raw), null, JSON.stringify(raw));
});

test("parseTab falls back to overview for unknown, wrong-type and non-string tabs", () => {
  assert.equal(parseTab("company", "listings"), "listings");
  assert.equal(parseTab("contact", "listings"), "overview"); // contacts have no listings tab
  assert.equal(parseTab("requirement", "map"), "overview"); // requirements have no map tab
  assert.equal(parseTab("company", "constructor"), "overview");
  assert.equal(parseTab("company", ["notes"]), "overview");
  assert.equal(parseTab("company", undefined), "overview");
});

test("every record type starts with the overview tab and has unique slugs", () => {
  for (const tabs of Object.values(RECORD_TABS)) {
    assert.equal(tabs[0].slug, "overview");
    assert.equal(new Set(tabs.map((t) => t.slug)).size, tabs.length);
  }
});

test("openRecordHref keeps other params and adds record", () => {
  const href = openRecordHref(
    { q: "pub", sort: "name", dir: "desc", page: "3" },
    { type: "company", id: ID },
  );
  const sp = new URLSearchParams(href.slice(1));
  assert.equal(sp.get("q"), "pub");
  assert.equal(sp.get("sort"), "name");
  assert.equal(sp.get("dir"), "desc");
  assert.equal(sp.get("page"), "3");
  assert.equal(sp.get("record"), `company:${ID}`);
  assert.equal(sp.get("tab"), null);
});

test("openRecordHref skips empty values and replaces an existing record and tab", () => {
  const href = openRecordHref(
    { q: undefined, type: "", record: `contact:${ID}`, tab: "notes" },
    { type: "requirement", id: ID },
  );
  assert.equal(href, `?record=${encodeURIComponent(`requirement:${ID}`)}`);
});

test("tabHref sets tab, and drops it for overview", () => {
  const ref = { type: "contact", id: ID } as const;
  const sp = new URLSearchParams(tabHref({ q: "a" }, ref, "notes").slice(1));
  assert.equal(sp.get("tab"), "notes");
  assert.equal(sp.get("q"), "a");
  assert.equal(new URLSearchParams(tabHref({ q: "a" }, ref, "overview").slice(1)).get("tab"), null);
});

test("closeRecordHref removes record and tab, keeps the rest", () => {
  const sp = new URLSearchParams(
    closeRecordHref({ q: "a", page: "2", record: `company:${ID}`, tab: "map" }).slice(1),
  );
  assert.equal(sp.get("q"), "a");
  assert.equal(sp.get("page"), "2");
  assert.equal(sp.has("record"), false);
  assert.equal(sp.has("tab"), false);
  assert.equal(closeRecordHref({ record: `company:${ID}`, tab: "map" }), "?");
});

test("fullRecordHref points at the record page", () => {
  assert.equal(fullRecordHref({ type: "company", id: ID }), `/companies/${ID}`);
  assert.equal(fullRecordHref({ type: "contact", id: ID }), `/contacts/${ID}`);
  assert.equal(fullRecordHref({ type: "requirement", id: ID }), `/requirements/${ID}`);
});

test("listing and deal have their own tabs and full pages", () => {
  assert.deepEqual(
    RECORD_TABS.listing.map((t) => t.slug),
    ["overview", "media", "map", "matchmaker", "deals", "notes"],
  );
  assert.deepEqual(
    RECORD_TABS.deal.map((t) => t.slug),
    ["overview", "notes"],
  );
  assert.equal(fullRecordHref({ type: "listing", id: ID }), `/listings/${ID}`);
  assert.equal(fullRecordHref({ type: "deal", id: ID }), `/deals/${ID}`);
  // A tab of another type is not valid for this one.
  assert.equal(parseTab("deal", "matchmaker"), "overview");
  assert.equal(parseTab("listing", "matchmaker"), "matchmaker");
  assert.equal(parseTab("listing", "send-history"), "overview");
});

test("every record type has the merged notes and to-dos tab, and none keeps the old ones", () => {
  for (const [type, tabs] of Object.entries(RECORD_TABS)) {
    assert.ok(tabs.some((t) => t.slug === "notes"), type);
    for (const old of ["todo", "reminders", "updates"]) {
      assert.ok(!tabs.some((t) => t.slug === old), `${type} still has ${old}`);
    }
  }
});

test("old todo, reminders and updates links open the notes tab", () => {
  for (const old of ["todo", "reminders", "updates"]) {
    assert.equal(parseTab("company", old), "notes", old);
    assert.equal(parseTab("deal", old), "notes", old);
    assert.equal(parseTab("listing", old), "notes", old);
  }
  // A tab the type does not have still falls back to the default.
  assert.equal(parseTab("deal", "matchmaker"), "overview");
});

test("a company has no contacts tab; an old contacts link opens the overview", () => {
  assert.ok(!RECORD_TABS.company.some((t) => t.slug === "contacts"));
  assert.equal(parseTab("company", "contacts"), "overview");
  // Requirements still have their own contacts tab.
  assert.equal(parseTab("requirement", "contacts"), "contacts");
});

test("PANEL_HOST_PATHS covers every list page and tasks", () => {
  for (const p of ["/companies", "/contacts", "/requirements", "/listings", "/deals", "/matches", "/tasks", "/dashboard"]) {
    assert.ok((PANEL_HOST_PATHS as readonly string[]).includes(p), p);
  }
});
