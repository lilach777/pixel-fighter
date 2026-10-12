/**
 * Test/debug hooks (window.__PF, window.__PFDemo) are compiled in only for development
 * builds and for builds made explicitly for end-to-end tests (VITE_E2E=true). A normal
 * `npm run build` removes them entirely.
 */
export const TEST_HOOKS: boolean = import.meta.env.DEV || import.meta.env.VITE_E2E === 'true';
