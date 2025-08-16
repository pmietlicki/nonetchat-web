import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// JSDOM ne simule pas scrollIntoView, nous devons donc le mocker.
window.Element.prototype.scrollIntoView = vi.fn();
