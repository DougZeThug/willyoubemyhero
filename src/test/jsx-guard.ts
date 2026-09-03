// Vitest setup: wrap the automatic JSX runtime so that whenever React is asked
// to render a null/undefined element type it names the props on the way down.
// The failing suite only says "got: undefined"; this says which element.
type JsxFactory = (type: unknown, props: unknown, key?: unknown) => unknown;

export function guardFactory(kind: "jsx" | "jsxs", factory: JsxFactory): JsxFactory {
  return (type, props, key) => {
    if (type == null) {
      console.error(`[jsx-guard] ${kind}() called with an undefined element type`, props);
    }
    return factory(type, props, key);
  };
}

export function guardedModule(actual: Record<string, unknown>): Record<string, unknown> {
  return {
    ...actual,
    jsx: guardFactory("jsx", actual.jsx as JsxFactory),
    jsxs: guardFactory("jsxs", actual.jsxs as JsxFactory),
  };
}
