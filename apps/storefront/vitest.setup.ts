import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Les matchers s'enregistrent sur le `expect` de CE workspace, quel que soit l'emplacement
// (hoisting npm) du paquet jest-dom : `jest-dom/vitest` importerait le Vitest de la racine.
expect.extend(matchers);

afterEach(() => {
  cleanup();
  localStorage.clear();
});
