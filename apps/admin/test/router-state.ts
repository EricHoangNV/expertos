// Shared, controllable `next/navigation` state for the admin jest harness (M15.2.1).
// The `__mocks__/next/navigation` manual mock reads from here so tests can assert
// on navigation (e.g. post-sign-in redirect) and set the current pathname.

export interface MockRouter {
  push: jest.Mock<void, [string]>;
  replace: jest.Mock<void, [string]>;
  back: jest.Mock<void, []>;
  forward: jest.Mock<void, []>;
  refresh: jest.Mock<void, []>;
  prefetch: jest.Mock<void, [string]>;
}

let router: MockRouter = makeRouter();
let pathname = "/";

function makeRouter(): MockRouter {
  return {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  };
}

export function getMockRouter(): MockRouter {
  return router;
}

export function getMockPathname(): string {
  return pathname;
}

export function setMockPathname(next: string): void {
  pathname = next;
}

/** Reset the router spies + pathname between tests (called from `jest.setup`). */
export function resetRouterState(): void {
  router = makeRouter();
  pathname = "/";
}
