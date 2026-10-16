"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export { default as Link } from "next/link";

/** wouter-style [path, navigate] pair on top of the Next.js router (keeps call sites tiny). */
export const useLocation = () => {
  const pathname = usePathname();
  const router = useRouter();
  const navigate = (to: string, options?: { replace?: boolean }) => (options?.replace ? router.replace(to) : router.push(to));
  return [pathname, navigate] as const;
};

/** Query string without the leading "?" (empty string when none). */
export const useSearch = () => useSearchParams().toString();
