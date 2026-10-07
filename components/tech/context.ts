"use client";

import { createContext, useContext } from "react";
import type { TechStore } from "@/lib/sync/client-store";
import type { SyncEngine } from "@/lib/sync/engine";

export interface TechContextValue {
  store: TechStore;
  engine: SyncEngine;
}

export const TechContext = createContext<TechContextValue | null>(null);

export function useTech(): TechContextValue {
  const value = useContext(TechContext);
  if (!value) throw new Error("useTech outside TechApp");
  return value;
}
