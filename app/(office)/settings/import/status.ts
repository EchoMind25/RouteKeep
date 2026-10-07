export const IMPORT_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "accent" }> = {
  uploaded: { label: "Match columns", tone: "warning" },
  mapped: { label: "Match columns", tone: "warning" },
  validating: { label: "Checking", tone: "neutral" },
  validated: { label: "Ready to import", tone: "accent" },
  committing: { label: "Importing", tone: "neutral" },
  committed: { label: "Imported", tone: "success" },
  reconciled: { label: "Imported", tone: "success" },
  rolling_back: { label: "Undoing", tone: "neutral" },
  rolled_back: { label: "Undone", tone: "neutral" },
  failed: { label: "Stopped", tone: "danger" },
};

export const SOURCE_LABEL: Record<string, string> = {
  csv: "Spreadsheet",
  routekeep: "Our own export",
  fieldroutes: "FieldRoutes export",
  pestpac: "PestPac export",
  gorilladesk: "GorillaDesk export",
  jobber: "Jobber export",
  quickbooks: "QuickBooks list",
};
