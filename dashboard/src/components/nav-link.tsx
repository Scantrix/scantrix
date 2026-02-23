"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNavigationLoading } from "@/components/loading-provider";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";

type NavLinkProps = ComponentPropsWithoutRef<typeof Link>;

/**
 * Drop-in replacement for `next/link` that triggers the global loading overlay
 * before navigating.  If the user clicks a link that points to the *current*
 * pathname, navigation is skipped (no overlay).
 */
export default function NavLink({ href, onClick, ...rest }: NavLinkProps) {
  const { startLoading } = useNavigationLoading();
  const pathname = usePathname();

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Resolve href to a string for comparison
    const target = typeof href === "string" ? href : href.pathname ?? "";

    // Don't show overlay when clicking the page we're already on
    if (target !== pathname) {
      startLoading();
    }

    // Forward any existing onClick handler
    onClick?.(e);
  };

  return <Link href={href} onClick={handleClick} {...rest} />;
}
