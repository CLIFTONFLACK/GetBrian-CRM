import { EmptyNote, Field, PanelSection } from "@/components/record-panel/fields";
import { EditableAddress, type AddressValue } from "@/components/record-panel/inline-edit";
import { LocationMap } from "@/components/location-map";
import type { FormState } from "@/lib/actions/types";

/**
 * The record's pin, and its address. Only rendered while the Map tab is active,
 * so Google Maps loads on demand. A record with no pin opens the address form,
 * so an address can be added here and the pin appears after the save.
 */
export function MapTab({
  lat,
  lng,
  label,
  recordId,
  address,
  addressAction,
}: {
  lat: number | null;
  lng: number | null;
  label: string;
  /** Supply the three together to make the address editable. Without them the tab is read-only. */
  recordId?: string;
  address?: AddressValue;
  addressAction?: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  if (!recordId || !address || !addressAction) {
    return (
      <PanelSection title="Location">
        {lat != null && lng != null ? (
          <LocationMap lat={lat} lng={lng} label={label} />
        ) : (
          <EmptyNote>No location on this record yet.</EmptyNote>
        )}
      </PanelSection>
    );
  }
  const hasPin = lat != null && lng != null;
  const hasAddress = Boolean(address.address_line || address.city || address.postcode);
  return (
    <PanelSection title="Location" className="space-y-4">
      {hasPin ? <LocationMap lat={lat} lng={lng} label={label} /> : null}
      <Field label="Address">
        <EditableAddress
          action={addressAction}
          recordId={recordId}
          address={address}
          startOpen={!hasAddress}
          heading={hasAddress ? undefined : "Add an address to show this record on the map"}
        />
      </Field>
      {!hasPin && hasAddress ? (
        <p className="text-xs text-muted-foreground">
          This address is saved but has no map pin yet. Edit it and check the postcode.
        </p>
      ) : null}
    </PanelSection>
  );
}
