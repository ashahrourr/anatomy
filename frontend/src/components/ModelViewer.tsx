// frontend/src/components/ModelViewer.tsx
"use client";


import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import Spinner from "./Spinner";

const BASE = process.env.NEXT_PUBLIC_ASSETS_BASE_URL;

/* ----------------------------------------------------
   🦴 Models
---------------------------------------------------- */
function AnatomyModels({
  highlightData,
  onReady,
}: {
  highlightData: any;
  onReady?: () => void;
}) {


const skeleton = useGLTF(`${BASE}/models/skeleton.draco.glb`, true).scene;
const muscles  = useGLTF(`${BASE}/models/muscles.draco.glb`, true).scene;
const joints   = useGLTF(`${BASE}/models/joints.draco.glb`, true).scene;
const nerves   = useGLTF(`${BASE}/models/nerves.draco.glb`, true).scene;


const materials = useRef({
  bone: new THREE.MeshStandardMaterial({ color: "#e8e4d8" }),

  muscle: new THREE.MeshStandardMaterial({
    color: "#d69a9a",
    transparent: true,
    opacity: 0.5,
    wireframe: true,
  }),

  jointWire: new THREE.MeshStandardMaterial({
    color: "#4da6ff",
    wireframe: true,
  }),

  nerve: new THREE.MeshStandardMaterial({
    color: "#f7f16d",
    transparent: true,
    opacity: 0.8,
  }),

  primary: new THREE.MeshStandardMaterial({
    color: "#ff3b3b",
  }),

  supporting: [
    new THREE.MeshStandardMaterial({ color: "#5af6ff", wireframe: true }),
    new THREE.MeshStandardMaterial({ color: "#ff2fb3", wireframe: true }),
    new THREE.MeshStandardMaterial({ color: "#00ff6a", wireframe: true }),
    new THREE.MeshStandardMaterial({ color: "#c300ff", wireframe: true }),
    new THREE.MeshStandardMaterial({ color: "#ff7b00", wireframe: true }),
  ],
});

useEffect(() => {
  onReady?.();
}, []);


  /* Center models */
// Center ALL models using the skeleton as the reference model
useEffect(() => {
  // 1️⃣ Compute skeleton center
  const box = new THREE.Box3().setFromObject(skeleton);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // 2️⃣ Shift skeleton to the origin
  skeleton.position.sub(center);

  // 3️⃣ Shift muscles & joints by the SAME center
  muscles.position.sub(center);
  joints.position.sub(center);
  nerves.position.sub(center);

}, []);







  /* Rim + AO on muscles */
useEffect(() => {
  const mat = materials.current.muscle;

  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <output_fragment>",
      `
      float rim = 1.0 - max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0);
      rim = smoothstep(0.25, 1.0, rim);
      gl_FragColor.rgb += rim * 0.18;

      float ao = pow(max(dot(normalize(vNormal), vec3(0,0,1)), 0.0), 1.2);
      gl_FragColor.rgb *= mix(0.55, 1.0, ao);

      #include <output_fragment>
    `
    );
  };
}, []);




  /* MAIN HIGHLIGHT LOGIC */
  useEffect(() => {
    // Reset bones
skeleton.traverse((c: any) => {
  if (c.isMesh) c.material = materials.current.bone;
});

muscles.traverse((c: any) => {
  if (c.isMesh) c.material = materials.current.muscle;
});

joints.traverse((c: any) => {
  if (c.isMesh) c.material = materials.current.jointWire;
});

nerves.traverse((c: any) => {
  if (c.isMesh) c.material = materials.current.nerve;
});




    if (!highlightData) return;

    /* PRIMARY = fully filled red */
    if (highlightData.primary?.id) {
      const obj =
        skeleton.getObjectByName(highlightData.primary.id) ||
        muscles.getObjectByName(highlightData.primary.id) ||
        joints.getObjectByName(highlightData.primary.id) ||
        nerves.getObjectByName(highlightData.primary.id);

if (obj) {
  obj.traverse((c: any) => {
    if (c.isMesh) c.material = materials.current.primary;
  });
}

    }

    /* SUPPORTING = wireframe-only color */
// SUPPORTING STRUCTURES — each with a soft anatomical wireframe color
highlightData.supporting?.forEach((s: any, i: number) => {
  const obj =
    skeleton.getObjectByName(s.id) ||
    muscles.getObjectByName(s.id) ||
    joints.getObjectByName(s.id) ||
    nerves.getObjectByName(s.id);

  if (!obj) return;

  const baseMat =
    materials.current.supporting[i % materials.current.supporting.length];

  const isBone = !!skeleton.getObjectByName(s.id);
  const isNerve = !!nerves.getObjectByName(s.id);

  // bones & nerves = solid, muscles & joints = wireframe
  const matToUse =
    isBone || isNerve
      ? new THREE.MeshStandardMaterial({ color: baseMat.color })
      : baseMat;

  obj.traverse((c: any) => {
    if (!c.isMesh) return;
    c.material = matToUse;
  });
});



  }, [highlightData]);

  return (
    <>
      <primitive object={skeleton} />
      <primitive object={muscles} />
      <primitive object={joints} />
      <primitive object={nerves} />
    </>
  );
}



/* ----------------------------------------------------
   Camera Autofocus (unchanged)
---------------------------------------------------- */
function CameraAutoFocus({ highlight, controlsRef, isInteractingRef }: any) {
  const { camera, scene } = useThree();
  const targetCamPos = useRef<THREE.Vector3 | null>(null);
  const targetCenter = useRef<THREE.Vector3 | null>(null);


  useEffect(() => {
if (!highlight) return;

  let tries = 0;
  const interval = setInterval(() => {
    const targetObj = scene.getObjectByName(highlight);
    if (!targetObj) {
      if (++tries > 20) clearInterval(interval); // safety
      return;
    }

    // 👇 KEEP YOUR EXISTING LOGIC EXACTLY AS IS BELOW
    const box = new THREE.Box3().setFromObject(targetObj);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    const cam = camera as THREE.PerspectiveCamera;
    const fov = (cam.fov * Math.PI) / 180;
    let distance = (maxDim / 2) / Math.tan(fov / 2);
    distance = THREE.MathUtils.clamp(distance * 0.8, 0.6, 8);

    const dir = new THREE.Vector3()
      .subVectors(cam.position, center)
      .normalize();

    targetCamPos.current = center.clone().add(dir.multiplyScalar(distance));
    targetCenter.current = center;

    clearInterval(interval);
  }, 16); // ~1 frame

  return () => clearInterval(interval);
}, [highlight]);


  useFrame(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
if (isInteractingRef?.current) {
  // user took control → stop forcing camera/target
  targetCamPos.current = null;
  targetCenter.current = null;
  return;
}


    const cam = camera as THREE.PerspectiveCamera;

    // move camera to new position
    if (targetCamPos.current) {
      cam.position.lerp(targetCamPos.current, 0.12);
      if (cam.position.distanceTo(targetCamPos.current) < 0.01) {
        targetCamPos.current = null;
      }
    }

    // ✅ THIS is what makes rotation happen around the highlighted structure
    if (targetCenter.current) {
      ctrl.target.lerp(targetCenter.current, 0.12);
      if (ctrl.target.distanceTo(targetCenter.current) < 0.01) {
        targetCenter.current = null;
      }
    }

    ctrl.update();
  });

  return null;
}


function ClickPivot({ controlsRef }: any) {
  const { camera, gl, scene } = useThree();
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const targetPoint = useRef(new THREE.Vector3(0, 0, 0));
  const smoothTarget = useRef(new THREE.Vector3(0, 0, 0));

  // Track click vs drag
  const downPos = useRef({ x: 0, y: 0 });
  const isClick = useRef(false);

  // ✅ NEW: only drive controls.target when we actually need to animate to a new pivot
  const animating = useRef(false);

  useEffect(() => {
    const dom = gl.domElement;

    function onPointerDown(e: PointerEvent) {
      downPos.current = { x: e.clientX, y: e.clientY };
      isClick.current = true;
    }

    function onPointerMove(e: PointerEvent) {
      if (
        Math.abs(e.clientX - downPos.current.x) > 4 ||
        Math.abs(e.clientY - downPos.current.y) > 4
      ) {
        isClick.current = false;
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!isClick.current || !controlsRef.current) return;

      const rect = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      const objects: THREE.Mesh[] = [];
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) objects.push(o);
      });

      const hits = raycaster.intersectObjects(objects, true);
      if (hits.length === 0) return;

      // Set clicked point as new pivot
      targetPoint.current.copy(hits[0].point);

      // ✅ Start a short animation toward this new pivot
      smoothTarget.current.copy(controlsRef.current.target);
      animating.current = true;
    }

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
    };
  }, [camera, gl, scene]);

  useFrame(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;

    // ✅ Only update OrbitControls target while we're animating to a new click pivot
    if (!animating.current) return;

    smoothTarget.current.lerp(targetPoint.current, 0.15);
    ctrl.target.copy(smoothTarget.current);

    // stop once we’re close enough (no more fighting during zoom)
    if (smoothTarget.current.distanceTo(targetPoint.current) < 0.001) {
      ctrl.target.copy(targetPoint.current);
      animating.current = false;
    }
  });

  return null;
}




/* ----------------------------------------------------
   Viewer
---------------------------------------------------- */
export default function ModelViewer({ onReady }: { onReady?: () => void }) {
  const [highlightData, setHighlightData] = useState<any>(null);
  const controlsRef = useRef<any>(null);
  const isInteractingRef = useRef(false);

  const isTouch =
  typeof window !== "undefined" &&
  (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  useEffect(() => {
  console.time("MODEL TOTAL LOAD");
}, []);


  useEffect(() => {
    const handler = (e: any) => setHighlightData(e.detail);
    window.addEventListener("highlight-structures", handler);
    return () =>
      window.removeEventListener("highlight-structures", handler);
  }, []);
useEffect(() => {
  let ctrl: any = null;
  let onStart: any = null;
  let onEnd: any = null;

  let tries = 0;
  const t = setInterval(() => {
    ctrl = controlsRef.current;
    if (!ctrl) {
      if (++tries > 60) clearInterval(t);
      return;
    }

    onStart = () => (isInteractingRef.current = true);
    onEnd = () => (isInteractingRef.current = false);

    ctrl.addEventListener("start", onStart);
    ctrl.addEventListener("end", onEnd);

    clearInterval(t);
  }, 16);

  return () => {
    clearInterval(t);
    if (ctrl && onStart && onEnd) {
      ctrl.removeEventListener("start", onStart);
      ctrl.removeEventListener("end", onEnd);
    }
  };
}, []);




useGLTF.preload(`${BASE}/models/skeleton.draco.glb`, true);
useGLTF.preload(`${BASE}/models/muscles.draco.glb`, true);
useGLTF.preload(`${BASE}/models/joints.draco.glb`, true);
useGLTF.preload(`${BASE}/models/nerves.draco.glb`, true);




  return (
  <div className="w-full h-full relative">

<Canvas
  dpr={isTouch ? [1, 2] : [1, 2]}
  gl={{ antialias: !isTouch, powerPreference: "high-performance" }}
  camera={{ position: [0, 1.4, 4], fov: 45 }}
>


      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 10, 5]} intensity={1} />

<Suspense fallback={null}>
  <AnatomyModels
    highlightData={highlightData}
    onReady={onReady}
  />
</Suspense>


 <CameraAutoFocus
    highlight={highlightData?.primary?.id || null}
    controlsRef={controlsRef}
    isInteractingRef={isInteractingRef}
  />


<ClickPivot controlsRef={controlsRef} />

<OrbitControls
  ref={controlsRef}
  enableDamping
  enableZoom
  dampingFactor={0.12}
  minDistance={0.1}
  maxDistance={10}
  zoomSpeed={1}
  enablePan={false}
  panSpeed={0}
  touches={{
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  }}
  rotateSpeed={0.6}
/>

    </Canvas>
  </div>
);

}