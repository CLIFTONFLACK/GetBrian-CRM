import type { RecordType } from "@/lib/record-ref";

/** The props every record tab receives. */
export type RecordTabProps = {
  entityType: RecordType;
  entityId: string;
  agencyId: string;
};
