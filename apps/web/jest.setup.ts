// Web jest harness setup (M15.1.1): jest-dom matchers, the firebase + fetch mocks,
// jsdom gaps the app touches, and per-test state reset.
import "@testing-library/jest-dom";
import { resetAuthState } from "./test/auth-state";
import { installFetchMock, resetApiMocks } from "./test/api-mock";
import { resetRouterState } from "./test/router-state";

// `src/lib/firebase.ts` reads this at module-eval to decide `isFirebaseConfigured`.
// Set it so `AuthProvider` registers its (mocked) auth listener instead of short-circuiting.
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "expertos-test";

// jsdom doesn't implement matchMedia (used by `useMediaQuery`) — provide a stub
// defaulting to "matches" so the desktop layout (sidebar + rail) renders in tests.
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

// jsdom doesn't implement scrollIntoView (the chat thread auto-scrolls to newest).
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
