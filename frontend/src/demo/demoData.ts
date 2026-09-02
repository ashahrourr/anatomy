// Fixture answers for demo mode.
//
// Every structure id below is taken from the real structures.json the
// production predictor ran on, so the highlights land on the same meshes the
// live model highlighted. Ids carry a trailing "l" / "r" for laterality, which
// is how the viewer resolves sides.

export type Structure = { id: string; label: string };

export type DemoCase = {
  /** shown as a suggestion chip */
  prompt: string;
  primary: Structure;
  supporting: Structure[];
};

export const DEMO_CASES: DemoCase[] = [
  {
    prompt: "sharp pain in my right shoulder when I lift my arm overhead",
    primary: { id: "Supraspinatus_muscler", label: "Supraspinatus muscle right" },
    supporting: [
      { id: "Subacromial_bursar", label: "Subacromial bursa right" },
      { id: "Infraspinatus_muscler", label: "Infraspinatus muscle right" },
      { id: "Acromial_part_of_deltoid_muscler", label: "Acromial part of deltoid muscle right" },
      { id: "Teres_minor_muscler", label: "Teres minor muscle right" },
    ],
  },
  {
    prompt: "dull ache in my lower back after lifting something heavy",
    primary: { id: "Quadratus_lumborum_musclel", label: "Quadratus lumborum muscle left" },
    supporting: [
      { id: "Multifidus_lumborum_musclel", label: "Multifidus lumborum muscle left" },
      { id: "Iliocostalis_lumborum_musclel", label: "Iliocostalis lumborum muscle left" },
      { id: "Iliolumbar_ligamentl", label: "Iliolumbar ligament left" },
    ],
  },
  {
    prompt: "my right knee hurts going down stairs",
    primary: { id: "Vastus_medialis_muscler", label: "Vastus medialis muscle right" },
    supporting: [
      { id: "Deep_infrapatellar_bursar", label: "Deep infrapatellar bursa right" },
      { id: "Subcutaneous_prepatellar_bursar", label: "Subcutaneous prepatellar bursa right" },
      { id: "Meniscopatellar_ligamentr", label: "Meniscopatellar ligament right" },
    ],
  },
  {
    prompt: "pins and needles in my right hand at night",
    primary: { id: "Median_nerver", label: "Median nerve right" },
    supporting: [
      { id: "Common_palmar_digital_branches_of_median_nerver", label: "Common palmar digital branches of median nerve right" },
      { id: "Palmar_branch_of_median_nerver", label: "Palmar branch of median nerve right" },
    ],
  },
  {
    prompt: "stiff neck and shoulders after sitting at a desk all day",
    primary: { id: "Descending_part_of_trapezius_musclel", label: "Descending part of trapezius muscle left" },
    supporting: [
      { id: "Levator_scapulael", label: "Levator scapulae left" },
      { id: "Longissimus_colli_musclel", label: "Longissimus colli muscle left" },
      { id: "Multifidus_colli_musclel", label: "Multifidus colli muscle left" },
    ],
  },
  {
    prompt: "rolled my left ankle playing football, sore on the outside",
    primary: { id: "Anterior_talofibular_ligamentl", label: "Anterior talofibular ligament left" },
    supporting: [
      { id: "Calcaneofibular_ligamentl", label: "Calcaneofibular ligament left" },
      { id: "Posterior_talofibular_ligamentl", label: "Posterior talofibular ligament left" },
    ],
  },
];

/** Large remaining count, so the paywall never fires in the demo. */
export const DEMO_CREDITS = {
  type: "device" as const,
  remaining: 999,
  limit: 999,
  reset_in: 0,
  locked: false,
};

const STOP = new Set([
  "a","an","the","my","me","i","in","on","at","of","to","and","when","after",
  "is","it","for","with","that","this","have","has","been","feel","feels",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t))
  );
}

/**
 * Pick the closest fixture to whatever the user typed. Jaccard over content
 * words — crude, but it only has to separate six cases, and it means free text
 * still does something sensible instead of failing.
 */
export function matchDemoCase(input: string): DemoCase | null {
  const q = tokens(input);
  if (!q.size) return null;

  let best: DemoCase | null = null;
  let bestScore = 0;

  for (const c of DEMO_CASES) {
    const t = tokens(c.prompt);
    let shared = 0;
    q.forEach((w) => { if (t.has(w)) shared++; });
    const score = shared / new Set([...q, ...t]).size;
    if (score > bestScore) { bestScore = score; best = c; }
  }

  return bestScore >= 0.12 ? best : null;
}
