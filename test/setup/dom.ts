import '@testing-library/jest-dom/vitest';

/**
 * jsdom setup for the SPA suites.
 *
 * Minimal on purpose: the components under test render no portals, open no
 * modals and depend on no browser API the jsdom environment lacks. Adding stubs
 * here is a signal that a component is reaching for something it should not need.
 */
