import * as React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

import { BRAND_FONT } from "./fonts";

// CDG Leisure brand palette (sampled from the reference particulars PDF) — NOT the
// product's. These particulars go out under the client agency's name, so they stay CDG
// teal even though the app itself is now on the Brian navy/gold ramp. Hard-coded rather
// than read from the design tokens precisely so a product rebrand can't leak into
// client-facing paperwork.
const TEAL = "#1ab6b6";
const BLACK = "#000000";
const INK = "#1a1a1a";
const MUTED = "#5f6b76";
const HAIRLINE = "#d9dee3";
const PANEL = "#f3f5f6";

export type FloorRow = { name: string; sqft: number | null; sqm: number | null };
export type DocSection = { title: string; content: string };

export type ParticularsData = {
  intel: boolean; // INTEL listing → unbranded PDF (no CDG logo / contact / disclaimer)
  statusTag: string; // "To Let" / "For Sale" / "To Let / For Sale"
  title: string;
  address: string;
  postcode: string | null;
  premiumTag: string | null; // small overlay tag on the hero, e.g. "NIL PREMIUM"
  summary: string | null; // teal headline on page 1
  sizeLine: string | null; // "4,623 sq ft"
  sizeSub: string | null; // "(429.49 sq m)"
  keyFeatures: string[];
  availableSize: string | null;
  epc: string | null;
  description: string | null;
  location: string | null;
  floors: FloorRow[];
  tenure: string | null;
  askingRent: string | null;
  premium: string | null;
  vat: string | null;
  licensing: string | null;
  sections: DocSection[];
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  agents: string[]; // internal CDG team assigned to this listing (lead first)
  generatedOn: string; // dd/mm/yyyy
  heroImage: Buffer | null;
  mapImage: Buffer | null; // Static Maps PNG of the location (null → placeholder)
};

const DISCLAIMER =
  "The particulars are set out as a general outline only for the guidance of intending purchasers or lessee and do not constitute nor constitute part of an offer or contract. They are issued without responsibility on the part of the Vendor, CDG Leisure Ltd or any of their respective employees or Agents. All descriptions dimensions references to condition and necessary permissions for use and occupation and other details are given in good faith and are believed to be correct but any intending purchasers or tenants should not rely on them as statements or representations of fact but must satisfy themselves by inspection independent advice or otherwise as to the correctness of each of them. No person in the employment of CDG Leisure Ltd or their Agents has any authority to make or give any representation or warranty whatever in relation to cdgleisure.com this property.";

// Neutral (unbranded) disclaimer for INTEL listings — no CDG Leisure / cdgleisure.com.
const DISCLAIMER_INTEL =
  "These particulars are set out as a general outline only for guidance and do not constitute, nor form part of, an offer or contract. They are issued without responsibility on the part of the agent or any of their employees. All descriptions, dimensions, references to condition and necessary permissions for use and occupation, and other details are given in good faith and are believed to be correct, but any intending purchasers or tenants should not rely on them as statements or representations of fact and must satisfy themselves by inspection, independent advice or otherwise as to the correctness of each of them.";

const CONFIDENTIALITY =
  "This sale is highly confidential and under no circumstances should a direct approach be made to staff as they are unaware of an impending sale.";
const HOLDING_DEPOSIT =
  "A holding deposit will be required to secure the property; the deposit will buy a period of exclusivity and will be held in the CDG Leisure client account.";
const HOLDING_DEPOSIT_INTEL =
  "A holding deposit will be required to secure the property; the deposit will buy a period of exclusivity and will be held in the agent's client account.";
const INTEL_MARKER = "Market intel — not for distribution";

const fmtSqft = (n: number | null) =>
  n != null ? n.toLocaleString("en-GB") : "—";

const styles = StyleSheet.create({
  page: {
    fontFamily: BRAND_FONT,
    fontSize: 9,
    color: INK,
    lineHeight: 1.38,
  },
  // ---- header bar ----
  header: {
    backgroundColor: BLACK,
    height: 58,
    paddingHorizontal: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoRow: { flexDirection: "row", alignItems: "center" },
  logoMark: { fontSize: 26, fontWeight: 700, color: TEAL, letterSpacing: -1 },
  logoTagWrap: { marginLeft: 8, justifyContent: "center" },
  logoLeisure: { fontSize: 9, fontWeight: 700, color: TEAL },
  logoJourney: { fontSize: 8, color: "#cfd4d8" },
  // Neutral header wordmark for INTEL (unbranded) particulars.
  neutralMark: { fontSize: 13, fontWeight: 700, color: "#ffffff", letterSpacing: 1 },
  intelFooterMark: { fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: 0.5 },
  statusTag: { fontSize: 20, fontWeight: 700, color: "#ffffff" },
  // ---- hero ----
  heroWrap: { position: "relative", width: "100%", height: 250 },
  hero: { width: "100%", height: 250, objectFit: "cover" },
  heroFallback: {
    width: "100%",
    height: 250,
    backgroundColor: PANEL,
    alignItems: "center",
    justifyContent: "center",
  },
  heroFallbackText: { color: MUTED, fontSize: 11 },
  premiumTag: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: BLACK,
    color: "#ffffff",
    fontSize: 8,
    fontWeight: 700,
    paddingVertical: 4,
    paddingHorizontal: 8,
    letterSpacing: 0.5,
  },
  // ---- title block ----
  body: { paddingHorizontal: 34, paddingTop: 16 },
  titleCenter: { textAlign: "center" },
  propTitle: { fontSize: 16, fontWeight: 700, color: INK },
  propAddress: { fontSize: 9.5, color: MUTED, marginTop: 2 },
  rule: { borderBottomWidth: 1, borderBottomColor: HAIRLINE, marginVertical: 14 },
  cols: { flexDirection: "row" },
  colLeft: { width: "44%", paddingRight: 18 },
  colRight: { width: "56%" },
  summaryHead: { fontSize: 15, fontWeight: 700, color: TEAL, lineHeight: 1.25 },
  sizeBig: { fontSize: 15, fontWeight: 700, color: INK, marginTop: 14 },
  sizeSub: { fontSize: 10, color: INK },
  bulletRow: { flexDirection: "row", marginBottom: 7 },
  bulletMark: { width: 9, color: TEAL, fontSize: 9 },
  bulletText: { flex: 1, fontSize: 10, color: INK },
  // ---- page 1 footer ----
  footer1: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 34,
    paddingTop: 10,
    paddingBottom: 22,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footer1Text: { fontSize: 10, color: INK, fontWeight: 600 },
  // ---- page 2 ----
  p2Header: {
    backgroundColor: BLACK,
    paddingHorizontal: 34,
    paddingVertical: 14,
  },
  p2HeaderText: { color: "#ffffff", fontSize: 12 },
  p2Body: { paddingHorizontal: 34, paddingTop: 13, flexDirection: "row" },
  p2Main: { width: "62%", paddingRight: 20 },
  p2Side: { width: "38%" },
  section: { marginBottom: 7 },
  sectionHead: { fontSize: 11, fontWeight: 700, color: TEAL, marginBottom: 3 },
  sectionBody: { fontSize: 9, color: INK },
  // summary key/value
  kvRow: { flexDirection: "row", marginBottom: 2 },
  kvKey: { width: 90, color: MUTED, fontSize: 9 },
  kvVal: { flex: 1, color: INK, fontSize: 9 },
  // accommodation table
  table: { marginTop: 2 },
  tHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 2,
  },
  tRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
    paddingVertical: 2,
  },
  tName: { width: "50%", fontSize: 9 },
  tNum: { width: "25%", fontSize: 9, textAlign: "right" },
  tHeadText: { fontWeight: 700, fontSize: 9 },
  tTotal: { fontWeight: 700 },
  // location panel (map substitute)
  mapPanel: {
    height: 150,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    position: "relative",
  },
  mapImg: { width: "100%", height: 150, objectFit: "cover" },
  mapPin: { fontSize: 22, color: TEAL, fontWeight: 700 },
  mapAddr: { fontSize: 8, color: MUTED, marginTop: 6, textAlign: "center", paddingHorizontal: 10 },
  postcodeBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: BLACK,
    color: "#ffffff",
    fontSize: 8,
    fontWeight: 700,
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  agentName: { fontSize: 10, fontWeight: 700, color: INK },
  agentLine: { fontSize: 9, color: INK, marginTop: 1 },
  // page 2 footer disclaimer
  footer2: {
    backgroundColor: BLACK,
    paddingHorizontal: 34,
    paddingVertical: 12,
    marginTop: 14,
  },
  disclaimer: { color: "#c7ccd1", fontSize: 6.5, lineHeight: 1.4 },
});

function Logo() {
  return (
    <View style={styles.logoRow}>
      <Text style={styles.logoMark}>cdg</Text>
      <View style={styles.logoTagWrap}>
        <Text style={styles.logoLeisure}>leisure</Text>
        <Text style={styles.logoJourney}>Join the journey.</Text>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionHead}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

export function ParticularsDocument({ d }: { d: ParticularsData }) {
  const hasFloors = d.floors.length > 0;
  const totalSqft = d.floors.reduce((s, f) => s + (f.sqft ?? 0), 0);
  const totalSqm = d.floors.reduce((s, f) => s + (f.sqm ?? 0), 0);

  return (
    <Document
      title={`${d.title} — Particulars`}
      author={d.intel ? "" : "CDG Leisure"}
    >
      {/* ---------- PAGE 1 ---------- */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          {d.intel ? (
            <Text style={styles.neutralMark}>PROPERTY PARTICULARS</Text>
          ) : (
            <Logo />
          )}
          <Text style={styles.statusTag}>{d.statusTag}</Text>
        </View>

        <View style={styles.heroWrap}>
          {d.heroImage ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image style={styles.hero} src={d.heroImage} />
          ) : (
            <View style={styles.heroFallback}>
              <Text style={styles.heroFallbackText}>{d.title}</Text>
            </View>
          )}
          {d.premiumTag ? (
            <Text style={styles.premiumTag}>{d.premiumTag}</Text>
          ) : null}
        </View>

        <View style={styles.body}>
          <View style={styles.titleCenter}>
            <Text style={styles.propTitle}>{d.title}</Text>
            {d.address ? (
              <Text style={styles.propAddress}>{d.address}</Text>
            ) : null}
          </View>
          <View style={styles.rule} />

          <View style={styles.cols}>
            <View style={styles.colLeft}>
              {d.summary ? (
                <Text style={styles.summaryHead}>{d.summary}</Text>
              ) : null}
              {d.sizeLine ? <Text style={styles.sizeBig}>{d.sizeLine}</Text> : null}
              {d.sizeSub ? <Text style={styles.sizeSub}>{d.sizeSub}</Text> : null}
            </View>
            <View style={styles.colRight}>
              {d.keyFeatures.map((f, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={styles.bulletMark}>■</Text>
                  <Text style={styles.bulletText}>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.footer1} fixed>
          {d.intel ? (
            <Text style={styles.intelFooterMark}>{INTEL_MARKER}</Text>
          ) : (
            <>
              <Text style={styles.footer1Text}>020 7100 5520</Text>
              <Text style={styles.footer1Text}>cdgleisure.com</Text>
            </>
          )}
        </View>
      </Page>

      {/* ---------- PAGE 2 ---------- */}
      <Page size="A4" style={styles.page}>
        <View style={styles.p2Header}>
          <Text style={styles.p2HeaderText}>
            {[d.title, d.address].filter(Boolean).join(", ")}
          </Text>
        </View>

        <View style={styles.p2Body}>
          <View style={styles.p2Main}>
            {(d.availableSize || d.epc) && (
              <View style={styles.section} wrap={false}>
                <Text style={styles.sectionHead}>Summary</Text>
                {d.availableSize ? (
                  <View style={styles.kvRow}>
                    <Text style={styles.kvKey}>Available Size</Text>
                    <Text style={styles.kvVal}>{d.availableSize}</Text>
                  </View>
                ) : null}
                <View style={styles.kvRow}>
                  <Text style={styles.kvKey}>EPC Rating</Text>
                  <Text style={styles.kvVal}>{d.epc ?? "Upon enquiry"}</Text>
                </View>
              </View>
            )}

            {d.description ? (
              <Section title="Description">{d.description}</Section>
            ) : null}
            {d.location ? <Section title="Location">{d.location}</Section> : null}

            {hasFloors ? (
              <View style={styles.section} wrap={false}>
                <Text style={styles.sectionHead}>Accommodation</Text>
                <Text style={styles.sectionBody}>
                  The accommodation comprises the following areas:
                </Text>
                <View style={styles.table}>
                  <View style={styles.tHead}>
                    <Text style={[styles.tName, styles.tHeadText]}>Name</Text>
                    <Text style={[styles.tNum, styles.tHeadText]}>sq ft</Text>
                    <Text style={[styles.tNum, styles.tHeadText]}>sq m</Text>
                  </View>
                  {d.floors.map((f, i) => (
                    <View key={i} style={styles.tRow}>
                      <Text style={styles.tName}>{f.name}</Text>
                      <Text style={styles.tNum}>{fmtSqft(f.sqft)}</Text>
                      <Text style={styles.tNum}>{fmtSqft(f.sqm)}</Text>
                    </View>
                  ))}
                  <View style={styles.tRow}>
                    <Text style={[styles.tName, styles.tTotal]}>Total</Text>
                    <Text style={[styles.tNum, styles.tTotal]}>
                      {fmtSqft(totalSqft)}
                    </Text>
                    <Text style={[styles.tNum, styles.tTotal]}>
                      {totalSqm ? totalSqm.toLocaleString("en-GB") : "—"}
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            {d.tenure ? <Section title="Tenure">{d.tenure}</Section> : null}
            {d.askingRent ? (
              <Section title="Asking Rent">{d.askingRent}</Section>
            ) : null}
            {d.premium ? <Section title="Premium">{d.premium}</Section> : null}
            {d.vat ? <Section title="VAT">{d.vat}</Section> : null}
            {d.licensing ? (
              <Section title="Planning / Licensing">{d.licensing}</Section>
            ) : null}

            {d.sections.map((s, i) => (
              <Section key={i} title={s.title}>
                {s.content}
              </Section>
            ))}

            <Section title="Confidentiality">{CONFIDENTIALITY}</Section>
            <Section title="Holding Deposit">
              {d.intel ? HOLDING_DEPOSIT_INTEL : HOLDING_DEPOSIT}
            </Section>
          </View>

          <View style={styles.p2Side}>
            <View style={styles.mapPanel}>
              {d.mapImage ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image style={styles.mapImg} src={d.mapImage} />
              ) : (
                <>
                  <Text style={styles.mapPin}>◉</Text>
                  {d.address ? (
                    <Text style={styles.mapAddr}>{d.address}</Text>
                  ) : null}
                </>
              )}
              {d.postcode ? (
                <Text style={styles.postcodeBadge}>{d.postcode}</Text>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionHead}>Viewing &amp; Further Information</Text>
              {d.agentName ? (
                <Text style={styles.agentName}>{d.agentName}</Text>
              ) : null}
              {d.agentPhone ? (
                <Text style={styles.agentLine}>{d.agentPhone}</Text>
              ) : null}
              {d.agentEmail ? (
                <Text style={styles.agentLine}>{d.agentEmail}</Text>
              ) : null}
              {!d.agentName && !d.agentPhone && !d.agentEmail && !d.intel ? (
                <Text style={styles.agentLine}>
                  020 7100 5520 · cdgleisure.com
                </Text>
              ) : null}
            </View>

            {d.agents.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionHead}>{d.intel ? "Team" : "CDG Team"}</Text>
                {d.agents.map((a, i) => (
                  <Text key={i} style={styles.agentLine}>
                    {a}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.footer2}>
          <Text style={styles.disclaimer}>
            {d.intel ? `${INTEL_MARKER}. ${DISCLAIMER_INTEL}` : DISCLAIMER} Generated
            on {d.generatedOn}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
