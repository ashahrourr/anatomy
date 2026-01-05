// frontend/src/components/ModelViewer.tsx
"use client";


import { Canvas, useThree, useFrame, invalidate } from "@react-three/fiber";
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

  // 🔵 wireframe supporting (muscles / joints)
  supportingWire: [
    new THREE.MeshStandardMaterial({ color: "#5af6ff", wireframe: true }),
    new THREE.MeshStandardMaterial({ color: "#ff2fb3", wireframe: true }),
    new THREE.MeshStandardMaterial({ color: "#00ff6a", wireframe: true }),
    new THREE.MeshStandardMaterial({ color: "#c300ff", wireframe: true }),
    new THREE.MeshStandardMaterial({ color: "#ff7b00", wireframe: true }),
  ],

  // 🟢 solid supporting (bones / nerves)
  supportingSolid: [
    new THREE.MeshStandardMaterial({ color: "#5af6ff" }),
    new THREE.MeshStandardMaterial({ color: "#ff2fb3" }),
    new THREE.MeshStandardMaterial({ color: "#00ff6a" }),
    new THREE.MeshStandardMaterial({ color: "#c300ff" }),
    new THREE.MeshStandardMaterial({ color: "#ff7b00" }),
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

const wireMat =
  materials.current.supportingWire[
    i % materials.current.supportingWire.length
  ];

const solidMat =
  materials.current.supportingSolid[
    i % materials.current.supportingSolid.length
  ];

const isBone = !!skeleton.getObjectByName(s.id);
const isNerve = !!nerves.getObjectByName(s.id);

// bones & nerves = solid, muscles & joints = wireframe
const matToUse = isBone || isNerve ? solidMat : wireMat;


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
const activeFocusId = useRef(0);


useEffect(() => {
  if (!highlight) return;

  // 🔥 cancel any previous focus instantly
  activeFocusId.current += 1;
  const focusId = activeFocusId.current;

  const targetObj = scene.getObjectByName(highlight);
  if (!targetObj) return;

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

  // 🔥 hard reset previous motion
  targetCamPos.current = center.clone().add(dir.multiplyScalar(distance));
  targetCenter.current = center;
}, [highlight]);



useFrame(() => {
  const ctrl = controlsRef.current;
  if (!ctrl) return;

  if (isInteractingRef?.current) {
    targetCamPos.current = null;
    targetCenter.current = null;
    return;
  }

  const cam = camera as THREE.PerspectiveCamera;

  if (targetCamPos.current) {
    cam.position.lerp(targetCamPos.current, 0.15);
    if (cam.position.distanceToSquared(targetCamPos.current) < 0.0001) {
      cam.position.copy(targetCamPos.current);
      targetCamPos.current = null;
    }
  }

  if (targetCenter.current) {
    ctrl.target.lerp(targetCenter.current, 0.15);
    if (ctrl.target.distanceToSquared(targetCenter.current) < 0.0001) {
      ctrl.target.copy(targetCenter.current);
      targetCenter.current = null;
    }
  }

  if (!targetCamPos.current && !targetCenter.current) return;
  ctrl.update();

  invalidate(); // 👈 ADD THIS LINE
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
    invalidate();

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
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const vvMaxH = useRef(0);
  const [dpr, setDpr] = useState(2);



  const isTouch =
  typeof window !== "undefined" &&
  (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

//   useEffect(() => {
//   console.time("MODEL TOTAL LOAD");
// }, []);

useEffect(() => {
  if (typeof window === "undefined") return;

  const vv = window.visualViewport;
  if (!vv) return;

  // track max height (keyboard closed baseline)
  vvMaxH.current = Math.max(vvMaxH.current, vv.height);

  const onVVChange = () => {
    vvMaxH.current = Math.max(vvMaxH.current, vv.height);
    const open = vv.height < vvMaxH.current - 120; // threshold
    setKeyboardOpen(open);
  };

  vv.addEventListener("resize", onVVChange);
  vv.addEventListener("scroll", onVVChange);

  return () => {
    vv.removeEventListener("resize", onVVChange);
    vv.removeEventListener("scroll", onVVChange);
  };
}, []);

  useEffect(() => {
const handler = (e: any) => {
  setHighlightData(e.detail);
  invalidate();
};
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
  dpr={dpr}
  frameloop={keyboardOpen ? "never" : "demand"}
  gl={{ antialias: true, powerPreference: "high-performance" }}
  camera={{ position: [0, 1.4, 4], fov: 45 }}
  style={{ pointerEvents: keyboardOpen ? "none" : "auto" }}
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

onStart={() => {
  if (isTouch) setDpr(1);
  invalidate();
}}
onEnd={() => {
  if (isTouch) setTimeout(() => setDpr(2), 120);
  invalidate();
}}

/>



    </Canvas>
  </div>
);

}