import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Les matchers s'enregistrent sur le `expect` de CE workspace, quel que soit l'emplacement
// (hoisting npm) du paquet jest-dom : `jest-dom/vitest` importerait le Vitest de la racine.
expect.extend(matchers);

// jsdom n'implémente pas ces API utilisées par Radix et input-otp.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
document.elementFromPoint ??= () => null;

afterEach(() => {
  cleanup();
});
