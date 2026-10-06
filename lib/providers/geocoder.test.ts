import { describe, expect, it } from "vitest";
import { googleGeocoder, needsPinConfirmation } from "./geocoder";

function fakeFetch(body: unknown, capture?: (url: URL) => void): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    capture?.(input as URL);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

const address = { line1: "1450 S Sandhill Rd", city: "Orem", region: "UT", postalCode: "84058" };

describe("google geocoder", () => {
  it("sends only the address (NFR-08)", async () => {
    let sent: URL | undefined;
    await googleGeocoder("k", fakeFetch({ status: "ZERO_RESULTS", results: [] }, (u) => (sent = u))).geocode(address);
    expect([...sent!.searchParams.keys()].sort()).toEqual(["address", "components", "key"]);
    expect(sent!.searchParams.get("address")).toBe("1450 S Sandhill Rd, Orem, UT 84058");
  });

  it("trusts rooftop matches and flags approximate ones for a person to confirm (R-BUG-05)", async () => {
    const rooftop = await googleGeocoder(
      "k",
      fakeFetch({ status: "OK", results: [{ formatted_address: "x", geometry: { location: { lat: 40.27, lng: -111.69 }, location_type: "ROOFTOP" } }] }),
    ).geocode(address);
    expect(rooftop).toMatchObject({ lat: 40.27, lng: -111.69, confidence: 0.95 });
    expect(needsPinConfirmation(rooftop!.confidence)).toBe(false);

    const vague = await googleGeocoder(
      "k",
      fakeFetch({
        status: "OK",
        results: [
          { formatted_address: "Orem, UT, USA", partial_match: true, geometry: { location: { lat: 40.29, lng: -111.69 }, location_type: "APPROXIMATE" } },
          { formatted_address: "Provo, UT, USA", geometry: { location: { lat: 40.23, lng: -111.65 }, location_type: "APPROXIMATE" } },
        ],
      }),
    ).geocode(address);
    expect(vague!.confidence).toBe(0);
    expect(needsPinConfirmation(vague!.confidence)).toBe(true);
  });

  it("treats provider failures as 'place the pin by hand'", async () => {
    expect(await googleGeocoder("k", fakeFetch({ status: "REQUEST_DENIED", results: [] })).geocode(address)).toBeNull();
    expect(needsPinConfirmation(null)).toBe(true);
  });
});
