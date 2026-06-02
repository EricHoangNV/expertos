// Manual jest mock for `next/navigation` (auto-applied to every web test, M15.1.1).
// Delegates to the test-controllable `test/router-state` singleton.
import {
  getMockPathname,
  getMockRouter,
  type MockRouter,
} from "../../test/router-state";

export function useRouter(): MockRouter {
  return getMockRouter();
}

export function usePathname(): string {
  return getMockPathname();
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function redirect(): never {
  throw new Error("NEXT_REDIRECT");
}
