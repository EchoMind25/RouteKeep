// Geocoding (D-08, FR-CRM-02, NFR-07, NFR-08, R-BUG-05).
//
// Only the street address is ever sent to a provider: never a customer name,
// phone, email or note. Results are stored on the property and reused, so an
// address is geocoded once unless it changes.

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** 0..1. Below CONFIRM_THRESHOLD a person must confirm the pin. */
  confidence: number;
  source: string;
  /** What the provider matched, for the confirm step ("1450 S Sandhill Rd, Orem, UT 84058, USA"). */
  matched: string;
}

export interface Geocoder {
  readonly name: string;
  geocode(address: { line1: string; city: string; region: string; postalCode: string }): Promise<GeocodeResult | null>;
}

export const CONFIRM_THRESHOLD = 0.8;

export function needsPinConfirmation(confidence: number | null | undefined): boolean {
  return confidence === null || confidence === undefined || confidence < CONFIRM_THRESHOLD;
}

/** No provider configured: every pin is placed by hand and confirmed. */
export const manualGeocoder: Geocoder = {
  name: "manual",
  async geocode() {
    return null;
  },
};

const LOCATION_CONFIDENCE: Record<string, number> = {
  ROOFTOP: 0.95,
  RANGE_INTERPOLATED: 0.8,
  GEOMETRIC_CENTER: 0.5,
  APPROXIMATE: 0.3,
};

interface GoogleResponse {
  status: string;
  results: {
    formatted_address: string;
    partial_match?: boolean;
    geometry: { location: { lat: number; lng: number }; location_type: string };
  }[];
}

/** Google Geocoding API (official REST endpoint, the tenant-agnostic platform key). */
export function googleGeocoder(apiKey: string, fetchImpl: typeof fetch = fetch): Geocoder {
  return {
    name: "google",
    async geocode(address) {
      const query = `${address.line1}, ${address.city}, ${address.region} ${address.postalCode}`;
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", query);
      url.searchParams.set("components", "country:US");
      url.searchParams.set("key", apiKey);
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) return null;
      const body = (await response.json()) as GoogleResponse;
      if (body.status !== "OK" || body.results.length === 0) return null;
      const best = body.results[0]!;
      let confidence = LOCATION_CONFIDENCE[best.geometry.location_type] ?? 0.3;
      if (best.partial_match) confidence -= 0.2;
      // Several candidates means the address was ambiguous.
      if (body.results.length > 1) confidence -= 0.1;
      return {
        lat: best.geometry.location.lat,
        lng: best.geometry.location.lng,
        confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(3)))),
        source: "google",
        matched: best.formatted_address,
      };
    },
  };
}
