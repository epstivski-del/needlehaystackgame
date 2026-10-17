// Test-only Three.js stand-in: every class/constant is a permissive no-op object. Exercises game logic, not pixels.
function stub() {
  const store = {}, f = function () {};
  return new Proxy(f, {
    get(t, k) { if (k === Symbol.toPrimitive) return () => 0; if (k === 'then') return undefined; if (k in store) return store[k]; return (store[k] = stub()); },
    set(t, k, v) { store[k] = v; return true; }, apply() { return stub(); }, construct() { return stub(); },
  });
}
