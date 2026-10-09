import { BRAND } from "@/lib/brand";
import { publicEnv } from "@/lib/public-env";

// Structured data for the public pages (FR-WEB-01). Only facts the site states
// itself: no ratings, reviews or customer counts until they are real.

export function JsonLd({ data }: { data: object | object[] }) {
  // "<" is escaped so no string in the data can close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function organization() {
  const url = publicEnv.siteUrl;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${url}/#organization`,
    name: BRAND.name,
    url: `${url}/`,
    logo: `${url}/icons/icon-512.png`,
    description: BRAND.tagline,
    ...(publicEnv.salesEmail ? { contactPoint: { "@type": "ContactPoint", contactType: "sales", email: publicEnv.salesEmail, areaServed: "US", availableLanguage: "en" } } : {}),
  };
}

export function website() {
  const url = publicEnv.siteUrl;
  return { "@context": "https://schema.org", "@type": "WebSite", "@id": `${url}/#website`, name: BRAND.name, url: `${url}/`, publisher: { "@id": `${url}/#organization` } };
}

/** Home, then the page. */
export function breadcrumb(name: string, path: string) {
  const url = publicEnv.siteUrl;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${url}/` },
      { "@type": "ListItem", position: 2, name, item: `${url}${path}` },
    ],
  };
}
