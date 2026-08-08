import "@testing-library/jest-dom/vitest";

// jsdom 不提供 ResizeObserver，Masonry 需要；提供最小 mock。
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}
