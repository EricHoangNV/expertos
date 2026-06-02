// Manual jest mock for `firebase/app` (auto-applied to every web test, M15.1.1).
// `src/lib/firebase.ts` only needs app init to hand a stub to `getAuth`.

export type FirebaseApp = { name: string };

const app: FirebaseApp = { name: "[DEFAULT]" };
let initialized = false;

export function getApps(): FirebaseApp[] {
  return initialized ? [app] : [];
}

export function getApp(): FirebaseApp {
  return app;
}

export function initializeApp(): FirebaseApp {
  initialized = true;
  return app;
}
