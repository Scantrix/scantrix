"use client";

import { MagnifyingGlass } from "react-loader-spinner";

export default function Spinner({ size = 64 }: { size?: number }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-3">
      <MagnifyingGlass
        visible
        height={size}
        width={size}
        ariaLabel="Loading"
        glassColor="#1e3a5f"
        color="#4c79f6"
      />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  );
}
