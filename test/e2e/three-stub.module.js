// Test-only Three.js stand-in: every class/constant is a permissive no-op object. Exercises game logic, not pixels.
function stub() {
  const store = {}, f = function () {};
  return new Proxy(f, {
    get(t, k) { if (k === Symbol.toPrimitive) return () => 0; if (k === 'then') return undefined; if (k in store) return store[k]; return (store[k] = stub()); },
    set(t, k, v) { store[k] = v; return true; }, apply() { return stub(); }, construct() { return stub(); },
  });
}
export const ACESFilmicToneMapping = stub();
export const AdditiveBlending = stub();
export const BackSide = stub();
export const BoxGeometry = stub();
export const BufferAttribute = stub();
export const BufferGeometry = stub();
export const CanvasTexture = stub();
export const ClampToEdgeWrapping = stub();
export const Color = stub();
export const CylinderGeometry = stub();
export const DirectionalLight = stub();
export const DoubleSide = stub();
export const Euler = stub();
export const Float32BufferAttribute = stub();
export const Fog = stub();
export const Group = stub();
export const HemisphereLight = stub();
export const InstancedMesh = stub();
export const Matrix4 = stub();
export const Mesh = stub();
export const MeshBasicMaterial = stub();
export const MeshLambertMaterial = stub();
export const MeshStandardMaterial = stub();
export const PCFSoftShadowMap = stub();
export const PerspectiveCamera = stub();
export const PlaneGeometry = stub();
export const Points = stub();
export const PointsMaterial = stub();
export const Quaternion = stub();
export const RepeatWrapping = stub();
export const SRGBColorSpace = stub();
export const Scene = stub();
export const Sphere = stub();
export const SphereGeometry = stub();
export const Sprite = stub();
export const SpriteMaterial = stub();
export const TorusGeometry = stub();
export const Vector3 = stub();
export const WebGLRenderer = stub();
export const plain = stub();
export const CircleGeometry = stub();
export const ConeGeometry = stub();
export const IcosahedronGeometry = stub();
export const OctahedronGeometry = stub();
export const PCFShadowMap = stub();
