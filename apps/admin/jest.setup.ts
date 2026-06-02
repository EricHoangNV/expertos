// Admin/expert portal jest harness setup (M15.2.1): jest-dom matchers, the firebase +
// fetch mocks, the jsdom gaps the portal touches, and per-test state reset. Mirrors
// `apps/web/jest.setup.ts`.
import "@testing-library/jest-dom";
import { resetAuthState } from "./test/auth-state";
import { installFetchMock, resetApiMocks } from "./test/api-mock";
import { resetRouterState } from "./test/router-state";

// `src/lib/firebase.ts` reads these at module-eval to decide `isFirebaseConfigured`. Set
// them so `AuthProvider` registers its (mocked) auth listener instead of short-circuiting.
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "expertos-test";

// jsdom doesn't implement matchMedia (some primitives read it); provide a stub defaulting
// to "matches" so the desktop layout renders in tests.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// jsdom doesn't implement scrollIntoView (lists/tables may scroll to a row).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

beforeEach(() => {
  installFetchMock();
  window.localStorage.clear();
});

afterEach(() => {
  resetApiMocks();
  resetAuthState();
  resetRouterState();
});
