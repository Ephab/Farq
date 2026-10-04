/* Waypoint cinematic deck.
   The world is one tall scene. A single thread (a Catmull-Rom path) runs from the logo's own thread tail to
   graduation; the camera rides a smoothed "rail" derived from that thread, so every move follows the roadmap.
   Each beat is a full state (camera, thread reveal, traveler, active scenes, open card), so Next and Back
   both work by transitioning to a state rather than replaying a script. */
(() => {
  "use strict";
  const W = 1920, VH = 1080, H = 11900;
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
  const LOGO = { x: 360, y: 300, w: 1200, srcW: 2029 };
  const k0 = LOGO.w / LOGO.srcW;
  const TAIL = [LOGO.x + 10 * k0, LOGO.y + 297 * k0];

  const knot = [];
  for (let i = 0; i < 13; i++) {
    const a = -1.9 + i * 2.25 + 0.7 * Math.sin(i * 3.1), r = 150 + 105 * Math.sin(i * 2.3 + 1);
    knot.push([600 + 70 * Math.sin(i * 0.9) + Math.cos(a) * r * 1.2, 1700 + 50 * Math.cos(i * 1.3) + Math.sin(a) * r * 0.9]);
  }
  const PTS = [TAIL, [350, 640], [430, 850], [640, 1000], [900, 1130], [960, 1290], [840, 1450], ...knot,
    [700, 1990], [960, 2120], [1350, 2330], [1620, 2600], [1600, 2830], [1320, 2872], [960, 2878], [600, 2875], [330, 2880],
    [110, 2960], [120, 3200], [300, 3450], [450, 3620], [540, 3820], [540, 4100], [540, 4380], [700, 4600], [960, 4740],
    [1030, 4980], [910, 5200], [1030, 5400], [910, 5600], [960, 5850], [960, 6150], [960, 6450], [960, 6700], [1180, 6950],
    [1330, 7250], [1330, 7650], [1250, 7980], [700, 7990], [590, 8250], [650, 8560], [1270, 8590], [1330, 8850],
    [1250, 9180], [700, 9190], [590, 9450], [650, 9760], [1270, 9790], [1330, 10050], [1250, 10380], [700, 10390],
    [590, 10650], [660, 10950], [960, 11250]];

  function catmull(p) {
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
    }
    return d;
  }
  const D = catmull(PTS);
  ["#main", "#glow", "#guide", "#trail"].forEach((s) => $(s).setAttribute("d", D));
  const thread = $("#thread");
  thread.setAttribute("viewBox", `0 0 ${W} ${H}`);

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
  let rx_ = sx, ry_ = sy;
  for (let k = 0; k < 3; k++) { rx_ = box(rx_, 55); ry_ = box(ry_, 55); }

  function at(ax, ay, l) {
    const f = clamp(l / STEP, 0, N), i = Math.floor(f), t = f - i, j = Math.min(N, i + 1);
    return [lerp(ax[i], ax[j], t), lerp(ay[i], ay[j], t)];
  }
  const pt = (l) => at(sx, sy, l);
  const rail = (l) => at(rx_, ry_, l);
  function nearest(ax, ay, x, y, from = 0, to = N) {
    let best = 0, bd = Infinity;
    for (let i = from; i <= to; i++) { const d = (ax[i] - x) ** 2 + (ay[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
    return best * STEP;
  }
  const onThread = (p) => nearest(sx, sy, p[0], p[1]);

  /* colour along the thread: ink at the logo, grey through the problems, rainbow after the convergence */
  const grad = $("#g-thread");
  grad.setAttribute("y2", H);
  [[0, "#17142B"], [560, "#17142B"], [1050, "#A7A3BA"], [6290, "#A7A3BA"], [6450, "#FF5E57"], [7650, "#FF5E57"],
   [8250, "#12B07A"], [8850, "#7457FF"], [9450, "#F29A00"], [10050, "#2C7BFF"], [10650, "#EC3F93"], [11250, "#7457FF"]]
    .forEach(([y, c]) => {
      const s = document.createElementNS("http://www.w3.org/2000/svg", "stop");
      s.setAttribute("offset", (y / H).toFixed(4)); s.setAttribute("stop-color", c); grad.appendChild(s);
    });

  /* depth: soft shapes at different z, so the 3D camera produces real parallax */
  (function depth() {
    const host = $("#depth");
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const greys = ["#D9D6E4", "#CFCBDD", "#E4E1EC"];
    const pal = ["#FF5E57", "#F2C200", "#12B07A", "#2C7BFF", "#7457FF", "#EC3F93", "#FF9A3C"];
    const types = ["", "ring", "sq", "plus"];
    for (let i = 0; i < 110; i++) {
      const y = rnd() * (H - 300);
      const edge = rnd() < 0.5;
      const x = edge ? rnd() * 330 - 60 : 1650 + rnd() * 330;
      const z = rnd() < 0.8 ? -900 + rnd() * 820 : 40 + rnd() * 160;
      const size = 18 + rnd() * (z > 0 ? 40 : 110);
      const warm = y > 6380;
      const col = warm ? pal[Math.floor(rnd() * pal.length)] : greys[Math.floor(rnd() * greys.length)];
      const el = document.createElement("i");
      el.className = "dp " + types[Math.floor(rnd() * types.length)];
      el.style.cssText = `width:${size}px;height:${size}px;color:${col};background:${col};opacity:${warm ? 0.5 : 0.75};transform:translate3d(${x}px,${y}px,${z}px) rotate(${rnd() * 90}deg)`;
      host.appendChild(el);
    }
  })();

  /* ---------------- camera, reveal, traveler ---------------- */
  const cam = { x: 960, y: 540, s: 1, rx: 0, rz: 0, l: 0 };
  function applyCam() {
    camera.style.transform = `translate(${W / 2}px,${VH / 2}px) scale(${cam.s}) rotateX(${cam.rx}deg) rotateZ(${cam.rz}deg) translate(${-cam.x}px,${-cam.y}px)`;
    const warm = clamp((cam.y - 5900) / 700, 0, 1);
    viewport.style.setProperty("--warm", warm.toFixed(3));
  }
  const rev = { l: 0 };
  const glowP = $("#glow");
  [mainP, glowP].forEach((p) => { p.style.strokeDasharray = `${L} ${L}`; });
  function applyRev() { const o = L - rev.l; mainP.style.strokeDashoffset = o; glowP.style.strokeDashoffset = o; }
  const trav = { l: 0 };
  const travEl = $("#traveler");
  function applyTrav() { const [x, y] = pt(trav.l); travEl.style.transform = `translate(${x}px,${y}px) scale(${stage.classList.contains("far") ? 5 : 1})`; }

  /* ---------------- beats ---------------- */
  const cardC = (k) => { const el = $("#card-" + k); return [el.offsetLeft + 300, el.offsetTop + 190]; };
  const END = [960, 11250];
  const KNOT_IN = onThread(knot[0]), KNOT_OUT = onThread(knot[knot.length - 1]);
  const CARD_COL = ["#FF5E57", "#12B07A", "#7457FF", "#F29A00", "#2C7BFF", "#EC3F93"];
  const GREY = "#9C98B3";

  const NOTE = {
    title: "افتتاح (0:00). «كلنا مرّينا بنفس اللحظة…» هذا Waypoint: رفيقك من أول يوم في الجامعة لين التخرّج. تابعوا الخيط.",
    lost: "المشكلة 1 (0:15). السنة الثالثة وما زلت ضايع: ما أعرف وش أتعلم بعدها ولا كيف المواد مرتبطة. مرشد واحد لمئات الطلاب.",
    gap: "المشكلة 2 (0:35). الجامعة تعلّم الأساس، لكن السوق يتحرك أسرع: Agents وRAG وDocker. تعرفها نظري وما تقدر تبنيها، والـ co-op آخر لحظة.",
    ai: "المشكلة 3 (0:55). الـ AI يسلّم الشغل بدالك، والتعلّم ما يصير. وما يعرفك أصلاً. وفي الجماعي: واحد يشتغل والباقي يتفرجون.",
    apps: "المشكلة 4 (1:10). أدوات كثيرة ومبعثرة، وكل وحدة تبدأ معك من الصفر.",
    conv: "الحل (1:25). جمعناها في تطبيق واحد يعرفك: مدرّب واحد، خريطة واحدة، رحلتك كلها.",
    ov: "(1:35) ست محطات على نفس الطريق، وقاعدة وحدة: Hermes يقترح وأنت تقرر. الدليل المستورد ما يصير حقيقة إلا بتأشيرك.",
    c1: "(1:45) البداية: يقرأ السجل والـ CV والـ GitHub والمجلدات. كل شيء يدخل كدليل مقترح.",
    c1b: "أشّر على اللي صح، وبس هو يصير حقيقة مؤكدة. اللي ما أشّرت عليه يبقى مقترح. والملفات نفسها ما تنحفظ.",
    c2: "(2:05) الخريطة من مقرراتك واهتماماتك ووقتك وهدفك، ومعها مهارات السوق.",
    c2b: "حتى أول خريطة اقتراح من Hermes، وما تتفعّل إلا لما تقبل. والمنجز والجاري مقفول على أي اقتراح.",
    c3: "(2:30) Hermes مدرّب يعرفك: يشرح من خلال اللي تعرفه، وما يحل عنك.",
    c3b: "يتأكد إنك فهمت بأسئلة وتمارين داخل المحادثة. وذاكرته لك وحدك، وما يتذكّر إلا اللي قلته أنت.",
    c4: "(2:55) كل مرحلة تنتهي بمشروع حقيقي تطوّر فكرته مع Hermes.",
    c4b: "ووكيل يشغّل المشروع فعلياً: اختبارات ومتصفح محلي، وكل درجة مربوطة بملاحظة. اللي فشل يبان.",
    c5: "(3:20) فرص co-op في شركات سعودية، مع سبب التوافق والناقص.",
    c5b: "«أضف لخريطتي» يصير اقتراح بانتظار موافقتك. والسيرة من بياناتك المؤكدة فقط، ولأي تخصص.",
    c6: "(3:45) المشاريع الجماعية: ارفع الملف، Hermes يطلّع المخرجات والمواعيد ويقترح توزيع عادل.",
    c6b: "الفريق يصوّت والأغلبية تعتمد، والقائد يحسم بعد 48 ساعة. Hermes زميل يقترح، مو بدالكم.",
    dest: "(4:15) وصلنا: من أول يوم لين التخرّج، وأنت عارف ليش.",
    j1: "(4:25) خذوا نظرة على الرحلة كاملة… «لو كان عندي Waypoint من أول يوم…»",
    j2: "«…ما كنت بوصل السنة الثالثة ضايع.»",
    fin: "(4:45) الخريطة اللي كلنا نستحقها. شكراً، ونستقبل أسئلتكم.",
  };

  const BEATS = [
    { id: "title", c: [960, 540], s: 1, trav: TAIL, rev: [640, 1000], scene: "s-title" },
    { id: "lost", c: [960, 1720], s: 1, trav: knot[0], rev: [960, 2120], scene: "s-lost", tc: GREY },
    { id: "gap", c: [960, 2890], s: 1, trav: [1150, 2876], rev: [300, 3450], scene: "s-gap", tc: GREY, cls: ["gap-on"] },
    { id: "ai", c: [960, 4080], s: 1, trav: [540, 3840], rev: [700, 4600], scene: "s-ai", tc: GREY, cls: ["gap-on"] },
    { id: "apps", c: [960, 5350], s: 1, trav: [1030, 4980], rev: [960, 6150], scene: "s-apps", tc: GREY, cls: ["gap-on"] },
    { id: "conv", c: [960, 6450], s: 1, trav: [960, 6450], rev: [1330, 7250], scene: "s-conv", tc: "#7457FF", cls: ["gap-on"] },
    { id: "ov", c: [840, 7640], s: 0.7, rx: -28, trav: [1330, 7250], rev: END, scene: "s-ov", tc: "#7457FF", cls: ["gap-on"] },
  ];
  for (let k = 1; k <= 6; k++) {
    const c = cardC(k);
    BEATS.push({ id: "c" + k, c, s: 1.3, trav: c, rev: END, panel: { id: k, built: false }, tc: CARD_COL[k - 1], card: k, cls: ["gap-on"] });
    BEATS.push({ id: "c" + k + "b", c, s: 1.3, trav: c, rev: END, panel: { id: k, built: true }, tc: CARD_COL[k - 1], card: k, cls: ["gap-on"] });
  }
  BEATS.push(
    { id: "dest", c: [960, 11320], s: 1, trav: END, rev: END, scene: "s-dest", tc: "#7457FF", cls: ["gap-on"] },
    { id: "j1", c: [960, 5900], s: 0.152, rz: 90, direct: true, trav: END, rev: END, tc: "#7457FF", cls: ["gap-on", "far", "j1"] },
    { id: "j2", c: [960, 5900], s: 0.152, rz: 90, direct: true, trav: END, rev: END, tc: "#7457FF", cls: ["gap-on", "far", "j2"] },
    { id: "fin", c: [960, 5900], s: 0.152, rz: 90, direct: true, trav: END, rev: END, tc: "#7457FF", cls: ["gap-on", "far", "fin-on"] },
  );
  BEATS.forEach((b) => {
    b.rx = b.rx || 0; b.rz = b.rz || 0;
    b.l = nearest(rx_, ry_, b.c[0], b.c[1]);
    const r = rail(b.l); b.ox = b.c[0] - r[0]; b.oy = b.c[1] - r[1];
    b.travL = b.trav === TAIL ? 0 : onThread(b.trav);
    b.revL = b.rev === END ? L : onThread(b.rev);
    b.note = NOTE[b.id] || "";
  });
  const IDX = Object.fromEntries(BEATS.map((b, i) => [b.id, i]));

  /* fly the scattered apps into the convergence node */
  $$("#s-apps .app").forEach((a) => {
    const cx = a.offsetLeft + a.offsetWidth / 2, cy = 4810 + a.offsetTop + a.offsetHeight / 2;
    a.style.setProperty("--tx", `${960 - cx}px`); a.style.setProperty("--ty", `${6450 - cy}px`);
  });
  $$(".card").forEach((c, i) => c.style.setProperty("--k", i));

  /* ---------------- scenes and stage classes ---------------- */
  const MANAGED = ["gap-on", "far", "j1", "j2", "fin-on"];
  function applyScenes(i) {
    const B = BEATS[i];
    BEATS.forEach((b, j) => { if (b.scene) document.getElementById(b.scene).classList.toggle("on", j <= i); });
    $("#s-apps").classList.toggle("merged", i >= IDX.conv);
    $$(".card").forEach((c, j) => {
      c.classList.toggle("lit", i >= IDX.ov);
      c.classList.toggle("done", i > IDX["c" + (j + 1) + "b"]);
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
  function playVideos(sec, on) {
    sec.querySelectorAll("video").forEach((v) => { if (on) { v.currentTime = 0; v.play().catch(() => {}); } else v.pause(); });
  }
  function counters(sec, on) {
    sec.querySelectorAll(".count").forEach((el) => {
      const to = +el.dataset.to, o = { v: on ? 0 : to };
      gsap.to(o, { v: on ? to : 0, duration: on ? 1.5 : 0.01, delay: on ? 0.3 : 0, ease: "power2.out", onUpdate: () => { el.textContent = Math.round(o.v); } });
    });
  }
  function setBuilt(id, built) {
    const sec = $("#sec-" + id);
    if (sec.classList.contains("built") === built) return;
    sec.classList.toggle("built", built);
    counters(sec, built);
  }

  function expand(tl, id, built, k, t0) {
    const sec = $("#sec-" + id), card = $("#card-" + id);
    let r, sc;
    tl.add(() => {
      r = cardRect(id); sc = r.w / 600;
      $$(".sec").forEach((s) => s.classList.remove("active", "in", "out", "built"));
      sec.classList.add("active");
      ghost.innerHTML = "";
      const g = card.cloneNode(true); g.removeAttribute("id"); g.classList.remove("cur"); g.style.left = g.style.top = "0"; ghost.appendChild(g);
      gsap.set(ghost, { x: r.l, y: r.t, scale: sc, opacity: 1 });
      Object.assign(clip, { t: r.t, r: W - (r.l + r.w), b: VH - (r.t + r.h), l: r.l, rad: 34 * sc }); setClip();
      panel.classList.add("open");
      card.style.visibility = "hidden";
    }, t0);
    tl.to(clip, { t: 0, r: 0, b: 0, l: 0, rad: 0, duration: 1.05 * k, ease: "expo.inOut", onUpdate: setClip }, t0 + 0.001);
    tl.to(ghost, {
      x: () => W / 2 - 300 * sc * 1.9, y: () => VH / 2 - 190 * sc * 1.9, scale: () => sc * 1.9, opacity: 0,
      duration: 0.9 * k, ease: "power2.in",
    }, t0 + 0.001);
    tl.add(() => { sec.classList.add("in"); playVideos(sec, true); if (built) setBuilt(id, true); }, t0 + 0.4 * k);
  }

  function collapse(tl, id, k, t0) {
    const sec = $("#sec-" + id), card = $("#card-" + id);
    let r, sc;
    tl.add(() => { sec.classList.remove("in"); sec.classList.add("out"); playVideos(sec, false); }, t0);
    tl.add(() => {
      r = cardRect(id); sc = r.w / 600;
      ghost.innerHTML = "";
      const g = card.cloneNode(true); g.removeAttribute("id"); g.classList.remove("cur"); g.style.left = g.style.top = "0"; g.style.visibility = "visible"; ghost.appendChild(g);
      gsap.set(ghost, { x: W / 2 - 300 * sc * 1.9, y: VH / 2 - 190 * sc * 1.9, scale: sc * 1.9, opacity: 0 });
    }, t0 + 0.25 * k);
    tl.to(clip, {
      t: () => r.t, r: () => W - (r.l + r.w), b: () => VH - (r.t + r.h), l: () => r.l, rad: () => 34 * sc,
      duration: 0.85 * k, ease: "expo.inOut", onUpdate: setClip,
    }, t0 + 0.26 * k);
    tl.to(ghost, { x: () => r.l, y: () => r.t, scale: () => sc, opacity: 1, duration: 0.8 * k, ease: "power2.out" }, t0 + 0.3 * k);
    tl.add(() => {
      panel.classList.remove("open"); card.style.visibility = "";
      sec.classList.remove("active", "out", "in", "built");
      ghost.innerHTML = "";
    }, t0 + 1.12 * k);
    return 1.12 * k;
  }

  /* ---------------- camera travel along the rail ---------------- */
  function travel(tl, A, B, k, t0) {
    const from = { ...cam }, dist = Math.hypot(B.c[0] - from.x, B.c[1] - from.y);
    const same = dist < 2 && Math.abs(B.s - from.s) < 0.001 && Math.abs(B.rx - from.rx) < 0.01 && Math.abs(B.rz - from.rz) < 0.01;
    const travFrom = trav.l, revFrom = rev.l;
    const revTo = Math.max(B.revL, k < 1 ? 0 : revFrom);
    if (same) {
      tl.to(trav, { l: B.travL, duration: 0.8 * k, ease: "power2.inOut", onUpdate: applyTrav }, t0);
      tl.to(rev, { l: B.revL, duration: 0.8 * k, onUpdate: applyRev }, t0);
      return 0;
    }
    const direct = B.direct || A.direct;
    const dur = (direct ? 4.2 : clamp(1.4 + dist / 2400, 1.4, 3.6)) * k;
    const bumpS = direct ? 0 : clamp(dist / 9000, 0, 0.34);
    const bumpRx = direct ? 0 : -clamp(dist / 120, 0, 18);
    const bank = direct ? 0 : clamp((B.c[0] - from.x) / 80, -6, 6);
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
        cam.rz = lerp(from.rz, B.rz, t) + bank * b;
        applyCam();
        // the traveler leads the camera slightly; the thread is drawn just ahead of the traveler
        trav.l = lerp(travFrom, B.travL, clamp(t * 1.15, 0, 1)); applyTrav();
        rev.l = Math.max(trav.l, lerp(revFrom, revTo, t)); applyRev();
      },
    }, t0);
    return dur;
  }

  /* ---------------- per-beat moments ---------------- */
  let loopTween = null;
  function stopLoops() { if (loopTween) { loopTween.kill(); loopTween = null; } }
  function confetti() {
    const host = $("#s-dest .confetti"); host.innerHTML = "";
    const pal = ["#FF5E57", "#F2C200", "#12B07A", "#2C7BFF", "#7457FF", "#EC3F93", "#FF9A3C"];
    for (let i = 0; i < 90; i++) {
      const e = document.createElement("i"); e.style.background = pal[i % pal.length]; host.appendChild(e);
      const a = Math.random() * Math.PI * 2, d = 250 + Math.random() * 650;
      gsap.fromTo(e, { x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 + Math.random() * 0.8 },
        { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.7 + 260, rotate: Math.random() * 720 - 360, opacity: 0, duration: 2.2 + Math.random() * 1.2, ease: "power3.out", delay: 0.5 + Math.random() * 0.2 });
    }
  }
  const trail = $("#trail");
  trail.style.strokeDasharray = `${L} ${L}`; trail.style.strokeDashoffset = L;
  function journey(on) {
    gsap.killTweensOf(trail); gsap.killTweensOf(trav, "l");
    if (!on) { trail.style.strokeWidth = 0; trail.style.strokeDashoffset = L; return; }
    trail.style.strokeWidth = 26; trail.style.strokeDashoffset = L;
    const o = { l: 0 };
    gsap.to(o, { l: L, duration: 4.2, ease: "power1.inOut", delay: 0.2, onUpdate() { trail.style.strokeDashoffset = L - o.l; trav.l = o.l; applyTrav(); } });
  }
  function enter(B, back) {
    stopLoops();
    if (B.id === "lost") {
      loopTween = gsap.fromTo(trav, { l: KNOT_IN }, { l: KNOT_OUT - 80, duration: 6, ease: "sine.inOut", yoyo: true, repeat: -1, onUpdate: applyTrav });
    }
    if (B.id === "dest" && !back) confetti();
    journey(B.id === "j1" && !back);
  }

  /* ---------------- transitions ---------------- */
  let cur = 0, tl = null;
  function go(to) {
    if (to < 0 || to >= BEATS.length || to === cur) return;
    if (tl) { tl.progress(1); tl.kill(); }
    stopLoops();
    const A = BEATS[cur], B = BEATS[to], back = to < cur, k = back ? 0.5 : 1;
    if (A.id === "j1" && B.id !== "j2") journey(false);
    if (A.id === "j1" && B.id === "j2") { /* let the light finish its run */ }
    cur = to;
    tl = gsap.timeline();
    let t = 0;
    const pA = A.panel, pB = B.panel;
    if (pA && (!pB || pA.id !== pB.id)) t += collapse(tl, pA.id, k, t);
    const dur = travel(tl, A, B, k, t);
    tl.add(() => applyScenes(to), t + dur * 0.5);
    tl.add(() => enter(B, back), t + dur);
    t += dur;
    if (pB && (!pA || pA.id !== pB.id)) expand(tl, pB.id, pB.built, k, t);
    else if (pB) tl.add(() => setBuilt(pB.id, pB.built), t);
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
    go,
    jump(i) {
      if (tl) { tl.progress(1); tl.kill(); }
      const B = BEATS[i]; stopLoops();
      $$(".sec").forEach((s) => s.classList.remove("active", "in", "out", "built"));
      panel.classList.remove("open"); $$(".card").forEach((c) => (c.style.visibility = ""));
      Object.assign(cam, { x: B.c[0], y: B.c[1], s: B.s, rx: B.rx, rz: B.rz, l: B.l }); applyCam();
      trav.l = B.travL; applyTrav(); rev.l = Math.max(B.revL, B.travL); applyRev();
      cur = i; applyScenes(i); introDone();
      if (B.panel) {
        const sec = $("#sec-" + B.panel.id);
        sec.classList.add("active", "in"); if (B.panel.built) setBuilt(B.panel.id, true);
        Object.assign(clip, { t: 0, r: 0, b: 0, l: 0, rad: 0 }); setClip(); panel.classList.add("open");
        $("#card-" + B.panel.id).style.visibility = "hidden"; playVideos(sec, true);
      }
      hud();
    },
  };

  /* ---------------- opening ---------------- */
  function introDone() { gsap.set("#s-title .t-logo", { clipPath: "inset(0 0% 0 0)" }); gsap.set(["#s-title .t-tag", "#s-title .t-farq", "#s-title .t-yu", "#s-title .t-hint"], { opacity: 1, y: 0 }); }
  applyCam(); applyTrav(); applyRev(); applyScenes(0);
  travEl.style.opacity = 0;
  const intro = gsap.timeline({ delay: 0.4 });
  intro.to("#s-title .t-logo", { clipPath: "inset(0 0% 0 0)", duration: 1.8, ease: "power2.inOut" })
    .to(["#s-title .t-farq", "#s-title .t-yu"], { opacity: 1, duration: 1 }, 0.6)
    .to("#s-title .t-tag", { opacity: 1, y: 0, duration: 1, ease: "power2.out" }, 1.3)
    .to(rev, { l: BEATS[0].revL, duration: 1.8, ease: "power2.inOut", onUpdate: applyRev }, 1.6)
    .to(travEl, { opacity: 1, duration: 0.6 }, 1.6)
    .to("#s-title .t-hint", { opacity: 1, duration: 0.8 }, 3);
  hud();
})();
