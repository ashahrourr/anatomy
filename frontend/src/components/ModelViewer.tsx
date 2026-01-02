// frontend/src/components/ModelViewer.tsx
"use client";

import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, useProgress} from "@react-three/drei";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import Spinner from "./Spinner";


  const BASE = process.env.NEXT_PUBLIC_ASSETS_BASE_URL;

/* ----------------------------------------------------
   🦴 Models
---------------------------------------------------- */
function AnatomyModels({ highlightData }: { highlightData: any }) {

  const skeleton = useGLTF(`${BASE}/models/skeleton.opt.glb`).scene;
  const muscles  = useGLTF(`${BASE}/models/muscles.opt.glb`).scene;
  const joints   = useGLTF(`${BASE}/models/joints.opt.glb`).scene;
  const nerves   = useGLTF(`${BASE}/models/nerves.opt.glb`).scene;



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

  /* Base materials */
  const boneMaterial = new THREE.MeshStandardMaterial({
    color: "#e8e4d8",
  });

  const muscleMaterial = new THREE.MeshStandardMaterial({
    color: "#d69a9a",
    transparent: true,
    opacity: 0.50,
  });

  const jointWireMaterial = new THREE.MeshStandardMaterial({
  color: "#4da6ff",   // soft bright blue
  wireframe: true,
  transparent: false, // wireframes don't need transparency
});

const nerveMaterial = new THREE.MeshStandardMaterial({
  color: "#f7f16d",      // soft nerve yellow
  transparent: true,
  opacity: 0.8,
});



useEffect(() => {
  joints.traverse((obj: any) => {
    if (obj.isMesh) {
      obj.material = jointWireMaterial.clone(); 
      obj.material.wireframe = true;
    }
  });
}, [joints]);


  /* Rim + AO on muscles */
  muscleMaterial.onBeforeCompile = (shader) => {
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

  /* Primary highlight material */
  const primaryMaterial = new THREE.MeshStandardMaterial({
    color: "#ff3b3b",
  });

  /* MAIN HIGHLIGHT LOGIC */
  useEffect(() => {
    // Reset bones
    skeleton.traverse((child: any) => {
      if (child.isMesh) child.material = boneMaterial;
    });

    // Reset muscles (transparent wireframes)
    muscles.traverse((child: any) => {
      if (child.isMesh) {
        child.material = muscleMaterial.clone();
        child.material.wireframe = true;
        child.material.color = new THREE.Color("#d69a9a");
      }
    });

    // Reset joints
joints.traverse((child: any) => {
  if (child.isMesh) child.material = jointWireMaterial.clone();
});
// Reset nerves
nerves.traverse((child: any) => {
  if (child.isMesh) {
    child.material = nerveMaterial.clone();
    child.material.wireframe = false;
    child.material.opacity = 0.8;
  }
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
        obj.traverse((child: any) => {
          if (child.isMesh) {
            child.material = primaryMaterial.clone();
            child.material.wireframe = false;
            child.material.opacity = 1;
          }
        });
      }
    }

    /* SUPPORTING = wireframe-only color */
// SUPPORTING STRUCTURES — each with a soft anatomical wireframe color
  const wireframeColors = [
    "#5af6ff",
    "#ff2fb3",
    "#00ff6a",
    "#c300ff",
    "#ff7b00",
  ];




highlightData.supporting?.forEach((s: any, index: number) => {
  const obj =
    skeleton.getObjectByName(s.id) ||
    muscles.getObjectByName(s.id) ||
    joints.getObjectByName(s.id) ||
    nerves.getObjectByName(s.id);

  if (!obj) return;

  const color = wireframeColors[index % wireframeColors.length];

    obj.traverse((child: any) => {
    if (!child.isMesh) return;

    const mat = child.material.clone();
    mat.color = new THREE.Color(color);
    mat.opacity = 1;

    // 🦴 Bone → solid
    if (skeleton.getObjectByName(s.id)) {
        mat.wireframe = false;
    }
    // 🧠 Nerve → solid yellow (no wireframe)
    else if (nerves.getObjectByName(s.id)) {
        mat.wireframe = false;
        mat.transparent = false; 
        mat.opacity = 1;
    }
    // 💪 Muscle or Joint → wireframe
    else {
        mat.wireframe = true;
    }

    child.material = mat;
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
function CameraAutoFocus({ highlight, controlsRef }: any) {
  const { camera, scene } = useThree();
  const targetCamPos = useRef<THREE.Vector3 | null>(null);
  const targetCenter = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    if (!highlight || !controlsRef.current) return;

    const targetObj = scene.getObjectByName(highlight);
    if (!targetObj) return;

    // 1) Get center of the highlighted object
    const box = new THREE.Box3().setFromObject(targetObj);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // 2) Compute a "close" distance based on size
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    const cam = camera as THREE.PerspectiveCamera;
    const fov = (cam.fov * Math.PI) / 180;

    // distance that fits the object, then make it closer
    let distance = (maxDim / 2) / Math.tan(fov / 2);

    // ✅ tweak this to taste (smaller = closer)
    distance *= 0.8;

    // ✅ keep it from going insane
    distance = THREE.MathUtils.clamp(distance, 0.6, 8);

    // 3) Keep current viewing direction, but relative to the *new center*
    const dir = new THREE.Vector3()
      .subVectors(cam.position, center)
      .normalize();

    const newPos = new THREE.Vector3().addVectors(
      center,
      dir.multiplyScalar(distance)
    );

    targetCamPos.current = newPos;
    targetCenter.current = center;
  }, [highlight, scene, camera]);

  useFrame(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;

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



function CanvasLoader() {
  const { active } = useProgress(); // true while anything is loading
  if (!active) return null;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1c1c1c]">
      <Spinner size={28} />
    </div>
  );
}


function ReportModelReady({ onReady }: { onReady?: () => void }) {
  if (typeof window === "undefined") return null;
  const { active, progress } = useProgress();

  const fired = useRef(false);

useEffect(() => {
  if (!fired.current && !active) {
    console.timeEnd("MODEL TOTAL LOAD");
    fired.current = true;
    onReady?.();
  }
}, [active, onReady]);


  return null;
}


/* ----------------------------------------------------
   Viewer
---------------------------------------------------- */
export default function ModelViewer({ onReady }: { onReady?: () => void }) {
  const [highlightData, setHighlightData] = useState<any>(null);
  const controlsRef = useRef<any>(null);
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
  (async () => {
    console.time("GLB skeleton");
    await useGLTF.preload(`${BASE}/models/skeleton.opt.glb`);
    console.timeEnd("GLB skeleton");

    console.time("GLB muscles");
    await useGLTF.preload(`${BASE}/models/muscles.opt.glb`);
    console.timeEnd("GLB muscles");

    console.time("GLB joints");
    await useGLTF.preload(`${BASE}/models/joints.opt.glb`);
    console.timeEnd("GLB joints");

    console.time("GLB nerves");
    await useGLTF.preload(`${BASE}/models/nerves.opt.glb`);
    console.timeEnd("GLB nerves");
  })();
}, []);


  return (
  <div className="w-full h-full relative">
    <CanvasLoader />

    <Canvas camera={{ position: [0, 1.4, 4], fov: 45 }}>
      <ReportModelReady onReady={onReady} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 10, 5]} intensity={1} />

      <Suspense fallback={null}>
        <AnatomyModels highlightData={highlightData} />
      </Suspense>

{!isTouch && (
      <CameraAutoFocus
        highlight={highlightData?.primary?.id || null}
        controlsRef={controlsRef}
      />
      )}

<ClickPivot controlsRef={controlsRef} />

      <OrbitControls
        ref={controlsRef}
        enableDamping
        enableZoom
        dampingFactor={0.12}
        minDistance={0.1}
        maxDistance={10}
        zoomSpeed={1}
        enablePan={!isTouch}
        rotateSpeed={0.6} 

      />
    </Canvas>
  </div>
);

}