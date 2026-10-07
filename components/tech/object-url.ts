"use client";

import { useEffect, useState } from "react";

/** A temporary URL for a stored image, released when the component goes away. */
export function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL must be created and revoked with the blob's lifetime
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [blob]);
  return url;
}
