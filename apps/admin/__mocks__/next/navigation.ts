// Manual jest mock for `next/navigation` (auto-applied to every admin test, M15.2.1).
// Delegates to the test-controllable `test/router-state` singleton.
import {
  getMockParams,
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

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return getMockParams() as T;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function redirect(): never {
  throw new Error("NEXT_REDIRECT");
}
