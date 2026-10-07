// ENG-10: an in-app entry for every release. Newest first. Written for the
// people using the product: what they can do now, not how it was built.

export interface ChangelogEntry {
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-10-07",
    title: "Technician app that works offline",
    items: [
      "Technicians install the app from the browser and open it straight to today's route. It works with no signal at all.",
      "Each stop walks through arrive, checklist, products, photos, signature, payment and complete, and is saved on the phone as it is typed.",
      "Products remember what was used at the property last time and read the mix back in plain words, so a decimal is never misread.",
      "A stop cannot be completed while a required record field is missing; the app names the field.",
      "Work done offline uploads by itself when the phone reconnects. If the office changed a stop in the meantime, the work is kept and flagged for review.",
      "Flagged visits appear on the schedule. Mark each one as it happened in the field, or keep the office's change; the product records stay either way.",
      "Outdoor mode for bright sun, in the app's settings.",
    ],
  },
  {
    date: "2026-10-07",
    title: "Dispatch board",
    items: [
      "The schedule shows each technician's route beside a map. Pick a stop in either place to find it in the other.",
      "Drag stops to reorder a route, hand them to another technician, or drop them on another day. The keyboard works too: Space to pick up, arrows to move, Space to drop.",
      "Undated, skipped and unassigned visits wait in Needs attention beside the map; drag them onto a route.",
      "Optimize shows the new order and the drive time saved before anything changes. Undo puts the old order back.",
      "Publishing warns about any stop reached by an unusually long drive, which is usually a wrong pin.",
      "Check pin: drag a property's pin onto the building and lock it so address changes and imports never move it.",
    ],
  },
  {
    date: "2026-10-06",
    title: "Customers, plans and the schedule",
    items: [
      "Create your business, invite your team and add technicians, plans and products.",
      "Add customers with their properties, sell a plan, and see 60 days of visits scheduled automatically.",
      "Change one visit or all future ones; skip, pause, cancel and restore with a reason on record.",
    ],
  },
];
