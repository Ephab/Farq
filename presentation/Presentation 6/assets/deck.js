/* Waypoint cinematic deck (v2, ~3:30).
   The world is one tall scene. A single thread (a Catmull-Rom path) leaves the dot over the i in "Waypoint",
   wanders through the problems, joins the tail of the second logo's own line, rides it back into the dot, and runs on
   through eight feature cards.
   The camera rides a heavily smoothed "rail" derived from the thread, so moves follow the road without jitter.
   Each beat is a full state (camera, thread reveal, traveler, scenes, open card), so Next and Back both work by
   transitioning to a state rather than replaying a script. */
(() => {
  "use strict";
  const W = 1920, VH = 1080, H = 12240;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const stage = $("#stage"), viewport = $("#viewport"), camera = $("#camera"), world = $("#world");
  const panel = $("#panel"), ghost = $("#ghost");
  let FIT = 1;
  function fit() { FIT = Math.min(innerWidth / W, innerHeight / VH); stage.style.setProperty("--fit", FIT); }
  addEventListener("resize", fit); fit();

  /* ---------------- thread geometry ---------------- */
  // The i-dot of the 2029px-wide logo sits at (1536.5, 93.5); both logos are 1200px wide at x=360, y=300 in their station.
  const k0 = 1200 / 2029;
  const DOT = [360 + 1536.5 * k0, 300 + 93.5 * k0];
  const MERGE_T = 5950, DOT2 = [DOT[0], MERGE_T + DOT[1]];
  // the free end of the swoosh in the logo (its left tail, at (5, 295) in the image): the road arrives here
  const lg = (x, y) => [360 + x * k0, MERGE_T + 300 + y * k0];
  const TAIL = lg(5, 295);

  const knot = [];
  for (let i = 0; i < 13; i++) {
    const a = -1.9 + i * 2.25 + 0.7 * Math.sin(i * 3.1), r = 140 + 95 * Math.sin(i * 2.3 + 1);
    knot.push([470 + 60 * Math.sin(i * 0.9) + Math.cos(a) * r * 1.2, 1560 + 40 * Math.cos(i * 1.3) + Math.sin(a) * r * 0.85]);
  }
  const CARDS = 8, CARD_Y0 = 7940, CARD_DY = 540;
  const cardPts = [];
  for (let k = 0; k < CARDS; k++) {
    const y = CARD_Y0 + k * CARD_DY, right = k % 2 === 0;
    cardPts.push([right ? 1330 : 590, y]);
    if (k < CARDS - 1) cardPts.push(...(right ? [[1250, y + 300], [700, y + 310]] : [[650, y + 300], [1270, y + 310]]));
  }
  const END = [960, 12100];
  const PTS = [DOT, [1440, 410], [1680, 520], [1720, 760], [1480, 930], [1100, 1030], [820, 1180], [640, 1290], ...knot,
    [900, 1800], [1500, 1790], [1840, 1900], [1820, 2100], [1600, 2160], [1120, 2160], [800, 2160], [300, 2170], [120, 2300],
    [70, 2600], [90, 3000], [60, 3400], [90, 3800], [70, 4300], [300, 4600], [900, 4720], [905, 5000], [910, 5350], [960, 5420],
    [900, 5800], [560, 5960], [220, 6120], [160, 6330], [255, 6465], TAIL,
    // hidden under the logo (masked): roughly along its swoosh, so the dot glides over the letters into the i
    lg(400, 215), lg(800, 250), lg(1180, 225), DOT2,
    [1440, MERGE_T + 410], [1680, MERGE_T + 520], [1740, MERGE_T + 770], [1500, MERGE_T + 1000], [1100, 7050], [1250, 7300], [1330, 7550],
    ...cardPts, [700, 12000], END];

  function catmull(p) {
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }
  const D = catmull(PTS);
  ["#main", "#glow", "#guide", "#trail"].forEach((s) => $(s).setAttribute("d", D));
  $("#thread").setAttribute("viewBox", `0 0 ${W} ${H}`);

  const mainP = $("#main");
  const L = mainP.getTotalLength();
  const STEP = 6, N = Math.ceil(L / STEP);
  const sx = new Float32Array(N + 1), sy = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) { const p = mainP.getPointAtLength(Math.min(L, i * STEP)); sx[i] = p.x; sy[i] = p.y; }

  function box(a, w) {
    const n = a.length, out = new Float32Array(n), pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
    for (let i = 0; i < n; i++) { const lo = Math.max(0, i - w), hi = Math.min(n - 1, i + w); out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); }
    return out;
  }
  // a wide, triple box filter ≈ a gaussian: the camera feels the road's direction but none of its squiggles
  let rx_ = sx, ry_ = sy;
  for (let k = 0; k < 3; k++) { rx_ = box(rx_, 90); ry_ = box(ry_, 90); }

  function at(ax, ay, l) {
    const f = clamp(l / STEP, 0, N), i = Math.floor(f), t = f - i, j = Math.min(N, i + 1);
    return [lerp(ax[i], ax[j], t), lerp(ay[i], ay[j], t)];
  }
  const pt = (l) => at(sx, sy, l);
  const rail = (l) => at(rx_, ry_, l);
  function nearest(ax, ay, x, y) {
    let best = 0, bd = Infinity;
    for (let i = 0; i <= N; i++) { const d = (ax[i] - x) ** 2 + (ay[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
    return best * STEP;
  }
  const onThread = (p) => nearest(sx, sy, p[0], p[1]);

  /* colour along the thread: ink from the dot, grey through the problems, ink again at the merge, then each card's colour */
  const grad = $("#g-thread");
  grad.setAttribute("y2", H);
  [[0, "#17142B"], [1000, "#17142B"], [1300, "#A7A3BA"], [6000, "#A7A3BA"], [6305, "#17142B"], [6800, "#3A3654"], [7700, "#FF5E57"],
   [CARD_Y0, "#FF5E57"], [CARD_Y0 + 540, "#12B07A"], [CARD_Y0 + 1080, "#7457FF"], [CARD_Y0 + 1620, "#0BA5C4"], [CARD_Y0 + 2160, "#F29A00"],
   [CARD_Y0 + 2700, "#2C7BFF"], [CARD_Y0 + 3240, "#EC3F93"], [CARD_Y0 + 3780, "#4B4FD8"], [END[1], "#7457FF"]]
    .forEach(([y, c]) => {
      const s = document.createElementNS("http://www.w3.org/2000/svg", "stop");
      s.setAttribute("offset", (y / H).toFixed(4)); s.setAttribute("stop-color", c); grad.appendChild(s);
    });

  /* depth: soft shapes at different z, so the 3D camera produces gentle parallax */
  (function depth() {
    const host = $("#depth");
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const greys = ["#D9D6E4", "#CFCBDD", "#E4E1EC"];
    const pal = ["#FF5E57", "#F2C200", "#12B07A", "#2C7BFF", "#7457FF", "#EC3F93", "#0BA5C4"];
    const types = ["", "ring", "sq", "plus"];
    for (let i = 0; i < 100; i++) {
      const y = rnd() * (H - 300);
      const x = rnd() < 0.5 ? rnd() * 300 - 60 : 1680 + rnd() * 300;
      const z = -950 + rnd() * 850; // always behind the content, so no shape ever covers text
      const size = 18 + rnd() * 100;
      const warm = y > 6300;
      const col = warm ? pal[Math.floor(rnd() * pal.length)] : greys[Math.floor(rnd() * greys.length)];
      const el = document.createElement("i");
      el.className = "dp " + types[Math.floor(rnd() * types.length)];
      el.style.cssText = `width:${size}px;height:${size}px;color:${col};background:${col};opacity:${warm ? 0.45 : 0.7};transform:translate3d(${x}px,${y}px,${z}px) rotate(${rnd() * 90}deg)`;
      host.appendChild(el);
    }
  })();

  /* ---------------- camera, reveal, traveler ---------------- */
  const cam = { x: 960, y: 540, s: 1, rx: 0, rz: 0, l: 0 };
  function applyCam() {
    camera.style.transform = `translate(${W / 2}px,${VH / 2}px) scale(${cam.s}) rotateX(${cam.rx}deg) rotateZ(${cam.rz}deg) translate(${-cam.x}px,${-cam.y}px)`;
    viewport.style.setProperty("--warm", clamp((cam.y - 5900) / 600, 0, 1).toFixed(3));
  }
  const rev = { l: 0 };
  const glowP = $("#glow");
  [mainP, glowP].forEach((p) => { p.style.strokeDasharray = `${L} ${L}`; });
  function applyRev() { const o = L - rev.l; mainP.style.strokeDashoffset = o; glowP.style.strokeDashoffset = o; }
  const trav = { l: 0 };
  const travEl = $("#traveler");
  function applyTrav() { const [x, y] = pt(trav.l); travEl.style.transform = `translate(${x}px,${y}px) `; }

  /* ---------------- beats ---------------- */
  const cardC = (k) => { const el = $("#card-" + k); return [el.offsetLeft + 300, el.offsetTop + 190]; };
  const CARD_COL = ["#FF5E57", "#12B07A", "#7457FF", "#0BA5C4", "#F29A00", "#2C7BFF", "#EC3F93", "#4B4FD8"];
  const GREY = "#9C98B3", INK = "#17142B";

  const NOTE = {
    title: "(0:00) كلنا مرّينا بنفس اللحظة… هذا Waypoint: رفيقك من أول يوم في الجامعة لين التخرّج. تابعوا النقطة.",
    p1: "(0:08) السنة الثالثة وما زلت ضايع: وش أتعلم بعدها؟ وش علاقة المواد ببعض؟ ومرشد واحد لمئات الطلاب. وبين الجامعة والسوق فجوة: السوق يطلب Agents وRAG وDocker، والمنهج متأخر.",
    stats: "(0:28) والأرقام تأكد: 48٪ من الخريجين مو جاهزين حتى يقدّمون (Cengage 2025، أمريكا). 39٪ من المهارات الأساسية بتتغير بحلول 2030 (WEF). و95٪ من الطلاب يستخدمون الذكاء الاصطناعي (HEPI 2026، بريطانيا).",
    roi: "(0:43) العائد: الطالب ياخذ خطة واضحة وتعلّم يثبت. الجامعة توصل لكل طالب وتساند المرشد. والسوق ياخذ خريجين جاهزين. هذي قيمة مقترحة؛ ما عندنا أرقام عائد مقاسة بعد.",
    p2: "(0:55) والمشكلة الثانية: الـ AI يحل عنا وما نتعلم، وفي الاختبار ما فيه AI. وأدواتنا مبعثرة: Blackboard وNotion وChatGPT وTelegram… ولا وحدة تعرفك.",
    merge: "(1:12) فجمعناها كلها… في نقطة وحدة. والطريق يكمل في Waypoint: تطبيق واحد يعرفك.",
    ov: "(1:20) ثماني محطات على طريق واحد: من أول يوم في الجامعة لين أول وظيفة.",
    c1: "(1:28) البداية: يقرأ سجلك والـ CV والـ GitHub وحساباتك. كل شي يوصلك كمقترح، واللي توافق عليه بس يدخل ملفك. والملفات نفسها ما تنحفظ.",
    c2: "(1:42) الخريطة من مقرراتك واهتماماتك ووقتك، وفيها مهارات السوق. حتى أول خريطة اقتراح، ما تتفعّل إلا لما تقبل. والمنجز والجاري ما ينلمس.",
    c3: "(1:56) Hermes مدرّب يعرفك: يشرح ويسأل ويتأكد إنك فهمت، وما يحل عنك. يعطيك خيارات واختيارك أنت اللي ينحفظ. وذاكرته لك وحدك.",
    c4: "(2:10) محاضراتك جاية من Blackboard: حدّد المحاضرات، اختر عدد الأسئلة والصعوبة، ويطلع لك اختبار: اختيار من متعدد، صح وخطأ، وإجابة قصيرة. وتقدر توسّع الشرائح: الأصل يبقى والجديد معلَّم AI.",
    c5: "(2:26) كل مرحلة تنتهي بمشروع حقيقي. ووكيل يشغّل مشروعك: اختبارات ومتصفح محلي وطلبات للـ backend، وكل درجة مربوطة بملاحظة. اللي فشل يبان.",
    c6: "(2:40) فرص co-op في شركات سعودية، مع درجة التوافق وشروط الأهلية واللي ينقصك. «أضف لخريطتي» يصير اقتراح بانتظار موافقتك.",
    c7: "(2:52) المشاريع الجماعية: ارفع الملف، Hermes يطلّع المخرجات والمواعيد ويقترح توزيع عادل. الفريق يصوّت، والأغلبية تعتمد، والقائد يحسم بعد 48 ساعة. Hermes زميل يقترح، مو بدالكم.",
    c8: "(3:06) وأكثر: مزامنة Blackboard، البريد الجامعي، مستجدات التعلم، السيرة الذاتية، وبياناتك… بالعربي والإنجليزي.",
    fin: "(3:16) هذي الرحلة كاملة: من أول يوم… لين التخرّج. شكراً، ونستقبل أسئلتكم.",
  };

  const BEATS = [
    { id: "title", c: [960, 540], s: 1, trav: DOT, rev: DOT, scene: "s-title", tc: INK, dot: true },
    { id: "p1", c: [960, 1740], s: 1, trav: [1130, 2160], rev: [300, 2170], scene: "s-p1", tc: GREY, cls: ["gap-on"] },
    { id: "stats", c: [960, 2990], s: 1, trav: [90, 3000], rev: [60, 3400], scene: "s-num", tc: GREY, cls: ["gap-on"] },
    { id: "roi", c: [960, 4040], s: 1, trav: [80, 4050], rev: [300, 4600], scene: "s-roi", tc: GREY, cls: ["gap-on"] },
    { id: "p2", c: [960, 5290], s: 1, trav: [910, 5350], rev: [900, 5800], scene: "s-p2", tc: GREY, cls: ["gap-on"] },
    { id: "merge", c: [960, 6490], s: 1, trav: DOT2, via: TAIL, rev: DOT2, scene: "s-merge", tc: INK, cls: ["gap-on"], dot: true, dur: 2.1 },
    { id: "ov", c: [880, 7620], s: 0.74, rx: -20, trav: [1330, 7550], rev: END, scene: "s-ov", tc: "#FF5E57", cls: ["gap-on"] },
  ];
  for (let k = 1; k <= CARDS; k++) {
    const c = cardC(k);
    BEATS.push({ id: "c" + k, c, s: 1.3, trav: c, rev: END, panel: k, tc: CARD_COL[k - 1], card: k, cls: ["gap-on"] });
  }
  // the finale is a screen-space map over the last card's view: the camera does not move
  { const c = cardC(CARDS); BEATS.push({ id: "fin", c, s: 1.3, trav: c, rev: END, tc: "#7457FF", cls: ["gap-on", "fin-on"], dur: 0.7 }); }
  BEATS.forEach((b) => {
    b.rx = b.rx || 0; b.rz = b.rz || 0;
    b.l = nearest(rx_, ry_, b.c[0], b.c[1]);
    const r = rail(b.l); b.ox = b.c[0] - r[0]; b.oy = b.c[1] - r[1];
    b.travL = b.trav === DOT ? 0 : onThread(b.trav);
    if (b.via) b.viaL = onThread(b.via);
    b.revL = b.rev === END ? L : b.rev === DOT ? 0 : onThread(b.rev);
    b.note = NOTE[b.id] || "";
  });
  const IDX = Object.fromEntries(BEATS.map((b, i) => [b.id, i]));

  /* each scattered app flies into the dot of the second logo */
  $$("#s-p2 .app").forEach((a) => {
    const cx = a.offsetLeft + a.offsetWidth / 2, cy = 4750 + a.offsetTop + a.offsetHeight / 2;
    a.style.setProperty("--tx", `${DOT2[0] - cx}px`); a.style.setProperty("--ty", `${DOT2[1] - cy}px`);
  });
  $$(".card").forEach((c, i) => c.style.setProperty("--k", i));

  /* ---------------- counters ---------------- */
  function counters(host, on) {
    host.querySelectorAll(".count").forEach((el) => {
      gsap.killTweensOf(el);
      const to = +el.dataset.to, o = { v: on ? 0 : to };
      if (!on) { el.textContent = "0"; return; }
      gsap.to(o, { v: to, duration: 1.6, delay: 0.5, ease: "power2.out", onUpdate: () => { el.textContent = Math.round(o.v); } });
    });
  }

  /* ---------------- scenes and stage classes ---------------- */
  const MANAGED = ["gap-on", "fin-on"];
  function applyScenes(i) {
    const B = BEATS[i];
    BEATS.forEach((b, j) => {
      if (!b.scene) return;
      const el = document.getElementById(b.scene), on = j <= i;
      if (b.id === "stats" && on !== el.classList.contains("on")) counters(el, on);
      el.classList.toggle("on", on);
    });
    if (i > IDX.merge) $("#s-merge").classList.add("lit", "landed");
    if (i < IDX.merge) $("#s-merge").classList.remove("lit", "landed");
    $$(".card").forEach((c, j) => {
      c.classList.toggle("lit", i >= IDX.ov);
      c.classList.toggle("done", i > IDX["c" + (j + 1)]);
      c.classList.toggle("cur", B.card === j + 1);
    });
    MANAGED.forEach((c) => stage.classList.toggle(c, (B.cls || []).includes(c)));
    world.classList.toggle("gap-on", (B.cls || []).includes("gap-on"));
    travEl.style.setProperty("--tc", B.tc || GREY);
    applyTrav();
  }

  /* ---------------- panel (card → full screen) ---------------- */
  const clip = { t: 0, r: 0, b: 0, l: 0, rad: 0 };
  const setClip = () => { panel.style.clipPath = `inset(${clip.t}px ${clip.r}px ${clip.b}px ${clip.l}px round ${clip.rad}px)`; };
  function cardRect(id) {
    const r = $("#card-" + id).getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { l: (r.left - s.left) / FIT, t: (r.top - s.top) / FIT, w: r.width / FIT, h: r.height / FIT };
  }
  // demos play once from the start and hold their last frame (the result), never a jarring loop restart
  function playVideos(sec, on) {
    sec.querySelectorAll("video").forEach((v) => { if (on) { v.currentTime = 0; v.play().catch(() => {}); } else v.pause(); });
  }
  function setBuilt(id, built) {
    const sec = $("#sec-" + id);
    if (sec.classList.contains("built") === built) return;
    sec.classList.toggle("built", built);
    counters(sec, built);
  }
  function cloneCard(id) {
    const g = $("#card-" + id).cloneNode(true);
    g.removeAttribute("id"); g.classList.remove("cur"); g.style.left = g.style.top = "0"; g.style.visibility = "visible";
    ghost.innerHTML = ""; ghost.appendChild(g);
  }

  function expand(tl, id, k, t0) {
    const sec = $("#sec-" + id), card = $("#card-" + id);
    let r, sc;
    tl.add(() => {
      r = cardRect(id); sc = r.w / 600;
      $$(".sec").forEach((s) => s.classList.remove("active", "in", "out", "built"));
      sec.classList.add("active");
      cloneCard(id);
      gsap.set(ghost, { x: r.l, y: r.t, scale: sc, opacity: 1 });
      Object.assign(clip, { t: r.t, r: W - (r.l + r.w), b: VH - (r.t + r.h), l: r.l, rad: 34 * sc }); setClip();
      panel.classList.add("open");
      card.style.visibility = "hidden";
    }, t0);
    tl.to(clip, { t: 0, r: 0, b: 0, l: 0, rad: 0, duration: 0.95 * k, ease: "expo.inOut", onUpdate: setClip }, t0 + 0.001);
    tl.to(ghost, {
      x: () => W / 2 - 300 * sc * 1.8, y: () => VH / 2 - 190 * sc * 1.8, scale: () => sc * 1.8, opacity: 0,
      duration: 0.8 * k, ease: "power2.in",
    }, t0 + 0.001);
    tl.add(() => { sec.classList.add("in"); playVideos(sec, true); }, t0 + 0.35 * k);
    tl.add(() => setBuilt(id, true), t0 + 1.6 * k);
  }

  function collapse(tl, id, k, t0) {
    const sec = $("#sec-" + id), card = $("#card-" + id);
    let r, sc;
    tl.add(() => { sec.classList.remove("in"); sec.classList.add("out"); playVideos(sec, false); }, t0);
    tl.add(() => {
      r = cardRect(id); sc = r.w / 600;
      cloneCard(id);
      gsap.set(ghost, { x: W / 2 - 300 * sc * 1.8, y: VH / 2 - 190 * sc * 1.8, scale: sc * 1.8, opacity: 0 });
    }, t0 + 0.2 * k);
    tl.to(clip, {
      t: () => r.t, r: () => W - (r.l + r.w), b: () => VH - (r.t + r.h), l: () => r.l, rad: () => 34 * sc,
      duration: 0.75 * k, ease: "expo.inOut", onUpdate: setClip,
    }, t0 + 0.21 * k);
    tl.to(ghost, { x: () => r.l, y: () => r.t, scale: () => sc, opacity: 1, duration: 0.7 * k, ease: "power2.out" }, t0 + 0.25 * k);
    tl.add(() => {
      panel.classList.remove("open"); card.style.visibility = "";
      sec.classList.remove("active", "out", "in", "built");
      ghost.innerHTML = "";
    }, t0 + 0.96 * k);
    return 0.96 * k;
  }

  /* ---------------- camera travel along the rail ---------------- */
  // Gentle by design: no banking, at most a 5° tilt and a 10% breath of zoom on long moves.
  function travel(tl, A, B, k, t0) {
    const from = { ...cam }, dist = Math.hypot(B.c[0] - from.x, B.c[1] - from.y);
    const travFrom = trav.l, revFrom = rev.l;
    const travTo = k === 1 && B.viaL != null ? B.viaL : B.travL;
    const revTo = k < 1 ? B.revL : Math.max(B.revL, revFrom);
    const direct = B.direct || A.direct;
    const dur = ((B.dur && k === 1) ? B.dur : direct ? 3.2 : clamp(1.0 + dist / 2600, 1.1, 2.4)) * k;
    const bumpS = direct ? 0 : clamp((dist - 500) / 10000, 0, 0.1);
    const bumpRx = direct ? 0 : -clamp(dist / 400, 0, 5);
    const fromOff = rail(from.l), ox0 = from.x - fromOff[0], oy0 = from.y - fromOff[1];
    const o = { t: 0 };
    tl.to(o, {
      t: 1, duration: dur, ease: direct ? "power3.inOut" : "power2.inOut",
      onUpdate() {
        const t = o.t, b = Math.sin(Math.PI * t);
        if (direct) { cam.x = lerp(from.x, B.c[0], t); cam.y = lerp(from.y, B.c[1], t); cam.l = B.l; }
        else {
          const l = lerp(from.l, B.l, t), p = rail(l);
          cam.l = l; cam.x = p[0] + lerp(ox0, B.ox, t); cam.y = p[1] + lerp(oy0, B.oy, t);
        }
        cam.s = direct ? Math.exp(lerp(Math.log(from.s), Math.log(B.s), t)) : lerp(from.s, B.s, t) * (1 - bumpS * b);
        cam.rx = lerp(from.rx, B.rx, t) + bumpRx * b;
        cam.rz = lerp(from.rz, B.rz, t);
        applyCam();
        trav.l = lerp(travFrom, travTo, t); applyTrav();
        rev.l = Math.max(trav.l, lerp(revFrom, revTo, t)); applyRev();
      },
    }, t0);
    return dur;
  }

  /* ---------------- finale map ---------------- */
  // The whole journey, flat: a grey scribble (the lost student) that finds the Waypoint dot, then one clean road
  // through the eight stations. Built once in its own SVG; the "zoom out" is a transform on a 1920px group.
  const NS = "http://www.w3.org/2000/svg";
  const FM = (() => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const mess = [[1840, 250]];
    for (let i = 1; i < 26; i++) {
      const t = i / 25, a = i * 2.35 + rnd() * 0.9, r = 40 + rnd() * 85 * (1 - t * 0.55);
      mess.push([1820 - t * 680 + Math.cos(a) * r, 250 + Math.sin(a) * r * 0.9]);
    }
    const dot = [1100, 250];
    mess.push([1160, 250], dot);
    const road = [dot];
    for (let i = 1; i <= 16; i++) road.push([1100 - i * (980 / 16), 250 + Math.sin(i * 0.8) * 34]);
    $("#fm-mess").setAttribute("d", catmull(mess));
    $("#fm-road").setAttribute("d", catmull(road));
    $("#fm-trace").setAttribute("d", catmull(mess) + " " + catmull(road).replace(/^M[^ ]+/, ""));
    $("#fm-dot").setAttribute("cx", dot[0]); $("#fm-dot").setAttribute("cy", dot[1]);
    $("#fm-wp").setAttribute("x", dot[0]);
    const g = $("#g-fin");
    CARD_COL.forEach((c, i) => { const st = document.createElementNS(NS, "stop"); st.setAttribute("offset", (i / (CARD_COL.length - 1)).toFixed(3)); st.setAttribute("stop-color", c); g.appendChild(st); });
    const roadP = $("#fm-road"), RL = roadP.getTotalLength();
    const LABELS = ["البداية", "الخريطة", "Hermes", "الاختبارات", "المشاريع", "الفرص", "الفريق", "وأكثر"];
    const stops = CARD_COL.map((c, i) => {
      const p = roadP.getPointAtLength(RL * (0.19 + i * 0.115));
      const el = document.createElementNS(NS, "g");
      el.innerHTML = `<circle class="fm-stop" cx="${p.x}" cy="${p.y}" r="16" fill="${c}"/><text class="fm-n" x="${p.x}" y="${p.y + 62}">${LABELS[i]}</text>`;
      $("#fm-stops").appendChild(el);
      return el;
    });
    const trace = $("#fm-trace"), TL = trace.getTotalLength();
    trace.style.strokeDasharray = `90 ${TL}`;
    return { stops, trace, TL };
  })();
  let finTl = null;
  function finale(on, instant) {
    if (finTl) { finTl.kill(); finTl = null; }
    if (!on) return;
    const z = $("#fm-zoom");
    if (instant) { gsap.set(z, { scale: 1, svgOrigin: "120 250" }); gsap.set(FM.stops, { scale: 1, opacity: 1 }); FM.trace.style.strokeDashoffset = 90; return; }
    finTl = gsap.timeline();
    // start close on the end of the road (where the last card was), then pull back to show the whole way here
    finTl.fromTo(z, { scale: 3.2, svgOrigin: "120 250" }, { scale: 1, svgOrigin: "120 250", duration: 2.2, ease: "power3.inOut" }, 0)
      .fromTo(FM.stops, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, stagger: -0.08, ease: "back.out(2)" }, 0.2)
      .fromTo(FM.trace, { strokeDashoffset: 90 }, { strokeDashoffset: 90 - FM.TL, duration: 3, ease: "power1.inOut" }, 2.0);
  }
  function enter(B, back) {
    // forward into the merge the dot is still riding the logo's line; it lands on the i at the end of the glide
    stage.classList.toggle("dotmode", !!B.dot && !(B.id === "merge" && !back));
    if (B.id === "merge") { $("#s-merge").classList.add("lit"); if (back) $("#s-merge").classList.add("landed"); }
    finale(B.id === "fin", back);
  }

  /* ---------------- transitions ---------------- */
  let cur = 0, tl = null;
  function go(to) {
    if (to < 0 || to >= BEATS.length || to === cur) return;
    if (tl) { tl.progress(1); tl.kill(); }
    const A = BEATS[cur], B = BEATS[to], back = to < cur, k = back ? 0.5 : 1;
    if (A.id === "fin") finale(false);
    stage.classList.remove("dotmode", "fin-now");
    $("#s-p2").classList.toggle("merged", to >= IDX.merge);
    $("#s-merge").classList.toggle("gather", to >= IDX.merge);
    if (to === IDX.merge && !back) $("#s-merge").classList.remove("landed");
    cur = to;
    tl = gsap.timeline();
    let t = 0;
    if (A.panel && A.panel !== B.panel) t += collapse(tl, A.panel, k, t) * 0.7; // the camera leaves while the card settles
    const dur = travel(tl, A, B, k, t);
    tl.add(() => applyScenes(to), t + dur * 0.5);
    tl.add(() => enter(B, back), t + dur);
    if (B.viaL != null && !back) {
      // glide from the logo's tail along its line into the i, while the logo is drawn from that tail
      tl.to(trav, { l: B.travL, duration: 1.5, ease: "power1.inOut", onUpdate: applyTrav }, t + dur);
      tl.add(() => { stage.classList.add("dotmode"); $("#s-merge").classList.add("landed"); }, t + dur + 1.5);
    }
    t += dur;
    if (B.panel && A.panel !== B.panel) expand(tl, B.panel, k, t);
    hud();
  }

  /* ---------------- HUD, notes, input ---------------- */
  let hudTimer = 0, t0 = 0;
  function hud() {
    $("#hud-bar i").style.width = (cur / (BEATS.length - 1)) * 100 + "%";
    $("#hud").classList.add("show"); clearTimeout(hudTimer);
    hudTimer = setTimeout(() => $("#hud").classList.remove("show"), 1800);
    $("#notes-text").textContent = BEATS[cur].note;
    if (!t0 && cur > 0) t0 = performance.now();
    updMeta();
  }
  function updMeta() {
    const s = t0 ? Math.floor((performance.now() - t0) / 1000) : 0;
    $("#notes-meta").textContent = `${cur + 1} / ${BEATS.length}   ·   ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  setInterval(updMeta, 1000);

  addEventListener("keydown", (e) => {
    if (e.repeat && !["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const k = e.key;
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(k)) { e.preventDefault(); go(cur + 1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(k)) { e.preventDefault(); go(cur - 1); }
    else if (k === "Home") go(0);
    else if (k === "End") go(BEATS.length - 1);
    else if (k === "f" || k === "F") { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); }
    else if (k === "n" || k === "N") $("#notes").hidden = !$("#notes").hidden;
  });
  addEventListener("click", (e) => { if (e.button === 0) go(cur + 1); });
  addEventListener("contextmenu", (e) => { e.preventDefault(); go(cur - 1); });
  let curTimer = 0;
  addEventListener("mousemove", () => { document.body.classList.add("cursor"); clearTimeout(curTimer); curTimer = setTimeout(() => document.body.classList.remove("cursor"), 1500); });

  /* debug/verification hook: jump straight to a beat (no animation) */
  window.__deck = {
    beats: BEATS.map((b) => b.id),
    get cur() { return cur; },
    get tl() { return tl; },
    cam,
    go,
    jump(i) {
      if (tl) { tl.progress(1); tl.kill(); }
      const B = BEATS[i];
      intro.progress(1);
      $$(".sec").forEach((s) => s.classList.remove("active", "in", "out", "built"));
      panel.classList.remove("open"); $$(".card").forEach((c) => (c.style.visibility = ""));
      Object.assign(cam, { x: B.c[0], y: B.c[1], s: B.s, rx: B.rx, rz: B.rz, l: B.l }); applyCam();
      trav.l = B.travL; rev.l = Math.max(B.revL, B.travL); applyRev();
      $("#s-p2").classList.toggle("merged", i >= IDX.merge);
      $("#s-merge").classList.toggle("gather", i >= IDX.merge);
      cur = i; applyScenes(i); enter(B, true);
      stage.classList.add("fin-now");
      if (B.panel) {
        const sec = $("#sec-" + B.panel);
        sec.classList.add("active", "in"); setBuilt(B.panel, true);
        Object.assign(clip, { t: 0, r: 0, b: 0, l: 0, rad: 0 }); setClip(); panel.classList.add("open");
        $("#card-" + B.panel).style.visibility = "hidden"; playVideos(sec, true);
      }
      hud();
    },
  };

  /* ---------------- opening ---------------- */
  applyCam(); applyTrav(); applyRev(); applyScenes(0);
  travEl.style.opacity = 0;
  const intro = gsap.timeline({ delay: 0.4 });
  intro.to("#s-title .t-logo", { clipPath: "inset(0 0% 0 0)", duration: 1.8, ease: "power2.inOut" })
    .to(travEl, { opacity: 1, duration: 0.35 }, 1.45)
    .to(["#s-title .t-farq", "#s-title .t-yu"], { opacity: 1, duration: 1 }, 0.6)
    .to("#s-title .t-tag", { opacity: 1, y: 0, duration: 1, ease: "power2.out" }, 1.4)
    .to("#s-title .t-hint", { opacity: 1, duration: 0.8 }, 2.6);
  hud();
})();
