import test from "node:test";
import assert from "node:assert/strict";
import {
  inferCompanyType,
  inferContactRole,
  hostOf,
  isFreeMailHost,
  domainLabels,
  normaliseName,
  chunk,
  groupBySlug,
  countBySlug,
} from "../type-inference.ts";

const TYPES = ["operator", "landlord", "agent", "vendor", "other"];
const ROLES = ["acquisitions", "landlord", "solicitor", "agent", "finance", "other"];

const co = (name: string | null, website: string | null = null, email: string | null = null, avail = TYPES) =>
  inferCompanyType({ name, website, email }, avail);
const slugOf = (r: { slug: string } | null) => (r ? r.slug : null);

// --- company: each rule -----------------------------------------------------

test("agent: estate agents phrase in the name", () => {
  const r = co("Smith & Co Estate Agents");
  assert.equal(r?.slug, "agent");
  assert.equal(r?.reason, 'name phrase "estate agents"');
});
test("agent: chartered surveyors", () => assert.equal(slugOf(co("Jones Chartered Surveyors")), "agent"));
test("agent: letting agents", () => assert.equal(slugOf(co("Town Letting Agents Ltd")), "agent"));
test("agent: commercial property agents", () => assert.equal(slugOf(co("North Commercial Property Agents")), "agent"));
test("agent: property consultants", () => assert.equal(slugOf(co("Hamptons Property Consultants")), "agent"));
test("agent: surveyors (medium)", () => assert.equal(slugOf(co("Ward Surveyors")), "agent"));
test("agent: agency (medium)", () => assert.equal(slugOf(co("Retail Agency LLP")), "agent"));
test("agent: well-known firm by name", () => {
  assert.equal(slugOf(co("Savills (UK) Ltd")), "agent");
  assert.equal(slugOf(co("Knight Frank LLP")), "agent");
  assert.equal(slugOf(co("Cushman & Wakefield")), "agent");
  assert.equal(slugOf(co("Christie & Co")), "agent");
  assert.equal(slugOf(co("BNP Paribas Real Estate")), "agent");
});
test("agent: well-known firm by domain", () => {
  assert.equal(slugOf(co("Acme", "https://www.savills.co.uk/")), "agent");
  assert.equal(slugOf(co(null, null, "x@cbre.com")), "agent");
  assert.equal(slugOf(co(null, "jll.com")), "agent");
});
test("agent: multi-word firm as one domain label", () => {
  assert.equal(slugOf(co(null, "www.knightfrank.com")), "agent");
  assert.equal(slugOf(co(null, "knight-frank.com")), "agent");
});

test("landlord: estates word", () => {
  const r = co("Landmark Estates");
  assert.equal(r?.slug, "landlord");
  assert.equal(r?.reason, 'name word "estates"');
});
test("landlord: properties, investments, real estate, trust", () => {
  assert.equal(slugOf(co("Northern Properties")), "landlord");
  assert.equal(slugOf(co("Green Investments")), "landlord");
  assert.equal(slugOf(co("Urban Real Estate")), "landlord");
  assert.equal(slugOf(co("Smith Family Trust")), "landlord");
});
test("landlord: reit and housing association (strong)", () => {
  assert.equal(slugOf(co("Big Box REIT plc")), "landlord");
  assert.equal(slugOf(co("Riverside Housing Association")), "landlord");
});
test("landlord: council and borough", () => {
  assert.equal(slugOf(co("Camden Council")), "landlord");
  assert.equal(slugOf(co("London Borough of Hackney")), "landlord");
});
test("landlord: by domain label", () => {
  const r = co("Acme Ltd", "https://acme-estates.co.uk");
  assert.equal(r?.slug, "landlord");
  assert.equal(r?.reason, 'web domain label "estates"');
});

test("operator: pubs word", () => {
  const r = co("Marston Pubs");
  assert.equal(r?.slug, "operator");
  assert.equal(r?.reason, 'name word "pubs"');
});
test("operator: restaurants, bars, coffee, hotels, gym", () => {
  assert.equal(slugOf(co("Cafe Nero Coffee")), "operator");
  assert.equal(slugOf(co("Prime Restaurants")), "operator");
  assert.equal(slugOf(co("Social Bars")), "operator");
  assert.equal(slugOf(co("City Hotels")), "operator");
  assert.equal(slugOf(co("Peak Gym")), "operator");
});
test("operator: by e-mail domain", () => {
  const r = co("Acme Ltd", null, "jo@thepubcompany.com");
  assert.equal(r, null); // "thepubcompany" is one label that is not "pubcompany"
  const r2 = co("Acme Ltd", null, "jo@pub-company.com");
  assert.equal(r2?.slug, "operator");
  assert.equal(r2?.reason, 'email domain phrase "pub company"');
});
test("operator: group alone is not enough", () => assert.equal(co("Smith Group"), null));

// --- whole word only --------------------------------------------------------

test("whole word: Highlands Pubs is not landlord", () => {
  assert.equal(slugOf(co("Highlands Pubs")), "operator");
});
test("whole word: Highlands alone gives nothing", () => assert.equal(co("Highlands"), null));
test("whole word: 'land' is not a rule and 'Standalone Estates Ltd' fine", () => {
  assert.equal(slugOf(co("Standalone Estates Ltd")), "landlord");
});
test("whole word: substring of a longer word does not match", () => {
  assert.equal(co("Barnstaple Holdings"), null); // "bar" inside barnstaple
  assert.equal(co("Pubsworth Limited"), null);
  assert.equal(co("Trustworthy Ltd"), null);
  assert.equal(co("Councillors Club"), null);
});
test("whole word: domain label must be whole", () => {
  assert.equal(co(null, "highlandspubs.co.uk"), null);
  assert.equal(co(null, "estatesmith.com"), null);
});

// --- strength, conflict, ambiguity -----------------------------------------

test("estate agents beats the word estate", () => {
  assert.equal(slugOf(co("Real Estate Agents Ltd")), "agent");
});
test("strong beats medium when types differ", () => {
  assert.equal(slugOf(co("Savills Properties")), "agent");
});
test("ambiguous equal strength gives null", () => {
  assert.equal(co("Hotels Estates"), null);
  assert.equal(co("Hotels Properties"), null);
});
test("name and domain agreeing lifts medium over a strong-free rival", () => {
  // name: operator bars (medium) + landlord estates (medium) is a tie ...
  assert.equal(co("Bar Estates"), null);
  // ... but a landlord domain label that agrees breaks it
  const r = co("Bar Estates", "https://www.acme-estates.com");
  assert.equal(r?.slug, "landlord");
  assert.equal(r?.reason, 'name word "estates" + web domain label "estates"');
});

// --- free mail, available, empty -------------------------------------------

test("free-mail domains are ignored", () => {
  for (const d of [
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.co.uk", "live.com", "msn.com",
    "yahoo.co.uk", "icloud.com", "me.com", "aol.com", "btinternet.com", "btconnect.com",
    "sky.com", "talktalk.net", "virginmedia.com", "proton.me", "protonmail.com",
  ]) {
    assert.equal(co("Acme", null, "someone@" + d), null, d);
  }
});
test("free-mail does not hide a real name hit", () => {
  assert.equal(slugOf(co("Smith Estates", null, "a@gmail.com")), "landlord");
});
test("a slug not in available returns null", () => {
  assert.equal(co("Smith Estates", null, null, ["operator", "other"]), null);
  assert.equal(co("Savills", null, null, []), null);
});
test("unavailable slug does not block an available one", () => {
  // agent unavailable, so the landlord hit stands alone
  assert.equal(slugOf(co("Savills Estates", null, null, ["landlord", "other"])), "landlord");
});
test("empty and null inputs", () => {
  assert.equal(co(null), null);
  assert.equal(co(""), null);
  assert.equal(co("   ", "", ""), null);
  assert.equal(co("!!!", "not a url", "no-at-sign"), null);
});

// --- domain parsing ---------------------------------------------------------

test("hostOf: protocol, www, path, port, e-mail", () => {
  assert.equal(hostOf("https://www.Example.co.uk:8080/a/b?x=1#y"), "www.example.co.uk");
  assert.equal(hostOf("example.com/path"), "example.com");
  assert.equal(hostOf("Jo Bloggs <jo@Example.com>".replace("Jo Bloggs <", "").replace(">", "")), "example.com");
  assert.equal(hostOf("mailto:jo@example.com"), "example.com");
  assert.equal(hostOf("localhost"), null);
  assert.equal(hostOf(""), null);
  assert.equal(hostOf(null), null);
});
test("domainLabels: co.uk, www, subdomains, hyphens kept in label", () => {
  assert.deepEqual(domainLabels("www.knight-frank.co.uk"), ["knight-frank"]);
  assert.deepEqual(domainLabels("mail.pubs.com"), ["mail", "pubs"]);
  assert.deepEqual(domainLabels("example.org.uk"), ["example"]);
  assert.deepEqual(domainLabels("example.com"), ["example"]);
  assert.deepEqual(domainLabels(null), []);
});
test("subdomain hit counts and the TLD is never a label", () => {
  assert.equal(slugOf(co(null, "https://shop.pubs.co.uk")), "operator");
  assert.equal(co(null, "https://acme.trust"), null); // "trust" here is the TLD
});
test("normaliseName: ampersand, punctuation, accents", () => {
  assert.equal(normaliseName("Strutt & Parker"), "strutt and parker");
  assert.equal(normaliseName("  The Pub-Co., Ltd! "), "the pub co ltd");
  assert.equal(normaliseName("Café Rouge"), "cafe rouge");
  assert.equal(normaliseName(null), "");
});
test("ampersand in a phrase: Strutt & Parker and Gerald Eve", () => {
  assert.equal(slugOf(co("Strutt & Parker")), "agent");
  assert.equal(slugOf(co("Gerald Eve LLP")), "agent");
});

// --- contact role -----------------------------------------------------------

const role = (
  email: string | null,
  companyType: string | null,
  companyName: string | null = null,
  avail = ROLES,
) => inferContactRole({ email, companyType, companyName }, avail);

test("role: solicitor by e-mail domain", () => {
  const r = role("jo@smith-solicitors.co.uk", "other");
  assert.equal(r?.slug, "solicitor");
  assert.equal(r?.reason, 'email domain label "solicitors"');
  assert.equal(slugOf(role("jo@brown-llp.com", null)), "solicitor");
  assert.equal(slugOf(role("jo@jones-law.com", null)), "solicitor");
  assert.equal(slugOf(role("jo@acme-legal.com", null)), "solicitor");
});
test("role: solicitor by company name", () => {
  const r = role(null, "other", "Brown & Co Solicitors");
  assert.equal(r?.slug, "solicitor");
  assert.equal(r?.reason, 'company name word "solicitors"');
  assert.equal(slugOf(role(null, null, "Lawyers For Business")), "solicitor");
});
test("role: Legal and General is not a solicitor", () => {
  assert.equal(role("jo@legalandgeneral.com", null, "Legal & General"), null);
});
test("role: finance by domain only", () => {
  assert.equal(slugOf(role("jo@acme-finance.com", "other")), "finance");
  assert.equal(slugOf(role("jo@big-bank.com", null)), "finance");
  assert.equal(slugOf(role("jo@mortgage-hub.co.uk", null)), "finance");
  // a company NAME with "capital" does not make the contact finance
  assert.equal(slugOf(role("jo@gmail.com", "landlord", "Grosvenor Capital")), "landlord");
});
test("role: follows the company type", () => {
  const l = role("jo@acme.com", "landlord");
  assert.equal(l?.slug, "landlord");
  assert.equal(l?.reason, 'company type "landlord"');
  assert.equal(slugOf(role(null, "agent")), "agent");
});
test("role: operator or unknown type gives nothing (never acquisitions)", () => {
  assert.equal(role("jo@acme.com", "operator"), null);
  assert.equal(role("jo@acme.com", "other"), null);
  assert.equal(role("jo@acme.com", null), null);
  assert.equal(role("jo@acme.com", "vendor"), null);
});
test("role: word rule beats company type", () => {
  assert.equal(slugOf(role("jo@smith-law.com", "landlord")), "solicitor");
});
test("role: solicitor and finance tie gives null, not the company type", () => {
  assert.equal(role("jo@legal-finance.com", "landlord"), null);
});
test("role: free-mail ignored but company type still applies", () => {
  assert.equal(role("jo@gmail.com", null), null);
  assert.equal(slugOf(role("jo-law@gmail.com", "landlord")), "landlord"); // local part never read
});
test("role: slug not available gives null or falls to the next rule", () => {
  assert.equal(role("jo@smith-law.com", null, null, ["other", "finance"]), null);
  assert.equal(slugOf(role("jo@smith-law.com", "agent", null, ["agent", "other"])), "agent");
  assert.equal(role("jo@acme.com", "landlord", null, ["other"]), null);
});
test("role: empty inputs", () => {
  assert.equal(role(null, null), null);
  assert.equal(role("", "", ""), null);
});

// --- plan helpers -----------------------------------------------------------

test("chunk splits and keeps order", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.deepEqual(chunk([1, 2], 500), [[1, 2]]);
  assert.deepEqual(chunk([1, 2, 3], 0), [[1], [2], [3]]); // size floor of 1, no endless loop
});
test("groupBySlug and countBySlug", () => {
  const c = [
    { id: "a", slug: "agent" },
    { id: "b", slug: "landlord" },
    { id: "c", slug: "agent" },
  ];
  const g = groupBySlug(c);
  assert.deepEqual([...g.keys()], ["agent", "landlord"]);
  assert.deepEqual(g.get("agent")?.map((x) => x.id), ["a", "c"]);
  assert.deepEqual(countBySlug(c), { agent: 2, landlord: 1 });
  assert.deepEqual(countBySlug([]), {});
});

test("isFreeMailHost: free-mail yes, business domain no", () => {
  assert.equal(isFreeMailHost("gmail.com"), true);
  assert.equal(isFreeMailHost("mail.outlook.co.uk"), true);
  assert.equal(isFreeMailHost("acme-estates.com"), false);
  assert.equal(isFreeMailHost("gmail.acme.com"), false); // free-mail name only as a subdomain
  assert.equal(isFreeMailHost(null), false);
});
