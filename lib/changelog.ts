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
