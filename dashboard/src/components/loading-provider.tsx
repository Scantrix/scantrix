"use client";

import { createContext, useCallback, useContext, useState } from "react";
import Spinner from "@/components/spinner";

interface LoadingCtx {
  /** Signal that a page transition has started. */
  startLoading: () => void;
  /** Signal that the destination page has finished loading its data. */
  stopLoading: () => void;
}

const LoadingContext = createContext<LoadingCtx>({
  startLoading: () => {},
  stopLoading: () => {},
});

/**
 * Global navigation-loading provider.
 *
 * Wrap the app layout with this component. When `startLoading()` is called
 * (e.g. by `<NavLink>` on click), a full-viewport Spinner overlay appears on
 * top of the *current* page.  The destination page calls `stopLoading()` once
 * its data has loaded, which unmounts the overlay and reveals the new content.
 */
export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(false);

  const startLoading = useCallback(() => setLoading(true), []);
  const stopLoading = useCallback(() => setLoading(false), []);

  return (
    <LoadingContext.Provider value={{ startLoading, stopLoading }}>
      {children}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <Spinner />
        </div>
      )}
    </LoadingContext.Provider>
  );
}

/** Hook for pages / components to access the global loading state. */
export function useNavigationLoading() {
  return useContext(LoadingContext);
}
