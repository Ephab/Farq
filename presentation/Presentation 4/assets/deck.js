/* Waypoint · "خط واحد"
   One line runs the whole talk. It starts as the road cut through the Waypoint wordmark, gets pulled out,
   tangles (lost), splits (the gap), flatlines (AI), shatters into app fragments, rejoins, carries the
   product along ten waypoints, and finally flies back into the logo. Scenes are hard cuts on top of it. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const W = 1920, H = 1080;

  /* ---------------- stage fit + atmosphere ---------------- */
  const stage = $('#stage');
  function fit() {
    const s = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  addEventListener('resize', fit); fit();

  (function grain() {
    const c = document.createElement('canvas'); c.width = c.height = 220;
    const g = c.getContext('2d'), img = g.createImageData(220, 220);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    $('#grain').style.backgroundImage = `url(${c.toDataURL()})`;
  })();

  /* split text into word spans (keeps Arabic letters joined inside each word) */
  function splitWords(el) {
    const walk = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const w = document.createElement('span'); w.className = 'w'; w.textContent = part; frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(el);
  }

  /* ---------------- the line ---------------- */
  const N = 900;
  const L = { pts: new Float32Array(N * 2), breaks: [], draw: 1, tip: 0 };
  const ln = $('#ln'), glow = $('#ln-glow'), flow = $('#ln-flow'), tip = $('#tip');
  glow.setAttribute('pathLength', '1');

  function render() {
    const p = L.pts, br = new Set(L.breaks);
    let d = '';
    for (let i = 0; i < N; i++) d += (i === 0 || br.has(i) ? 'M' : 'L') + p[2 * i].toFixed(1) + ',' + p[2 * i + 1].toFixed(1);
    ln.setAttribute('d', d); glow.setAttribute('d', d); flow.setAttribute('d', d);
    if (L.draw < 1) {
      for (const e of [ln, glow]) { e.style.strokeDasharray = '1 1'; e.style.strokeDashoffset = 1 - L.draw; }
    } else {
      for (const e of [ln, glow]) { e.style.strokeDasharray = ''; e.style.strokeDashoffset = ''; }
    }
    const k = Math.min(N - 1, Math.round(L.draw * (N - 1)));
    tip.setAttribute('cx', p[2 * k]); tip.setAttribute('cy', p[2 * k + 1]);
  }

  function resample(poly, n) {
    const acc = [0];
    for (let i = 1; i < poly.length; i++) acc.push(acc[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    const total = acc[acc.length - 1], out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : (k / (n - 1)) * total;
      while (j < poly.length - 2 && acc[j + 1] < t) j++;
      const f = (t - acc[j]) / ((acc[j + 1] - acc[j]) || 1);
      out.push([poly[j][0] + (poly[j + 1][0] - poly[j][0]) * f, poly[j][1] + (poly[j + 1][1] - poly[j][1]) * f]);
    }
    return out;
  }
  const flat = arr => { const f = new Float32Array(arr.length * 2); arr.forEach((p, i) => { f[2 * i] = p[0]; f[2 * i + 1] = p[1]; }); return f; };
  const one = poly => ({ pts: flat(resample(poly, N)), breaks: [] });
  function many(polys) {           // several fragments sharing the N points by length
    const lens = polys.map(p => p.reduce((s, q, i) => i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0, 0));
    const tot = lens.reduce((a, b) => a + b, 0);
    let used = 0; const out = [], breaks = [];
    polys.forEach((p, i) => {
      const n = i === polys.length - 1 ? N - used : Math.max(8, Math.round(N * lens[i] / tot));
      if (i) breaks.push(used);
      out.push(...resample(p, n)); used += n;
    });
    return { pts: flat(out), breaks };
  }
  function catmull(ctrl, seg = 24) {
    const out = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(i - 1, 0)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(i + 2, ctrl.length - 1)];
      for (let s = 0; s < seg; s++) {
        const t = s / seg, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(a => .5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
      }
    }
    out.push(ctrl[ctrl.length - 1]);
    return out;
  }

  /* logo placement (must match .logo-wrap) */
  const LX = 260, LY = 330, LK = 1400 / 2029;
  const DOT = [LX + 1532 * LK, LY + 91 * LK];

  const APPS = [['Notion', 1500, 300], ['ChatGPT', 1150, 250], ['Blackboard', 760, 320], ['Calendar', 370, 270],
    ['Quiz AI', 1600, 730], ['Telegram', 1040, 790], ['LinkedIn', 470, 760]];

  const hz = (y, amp = 10, x0 = 2000, x1 = -80) => {
    const poly = []; for (let x = x0; x >= x1; x -= 8) poly.push([x, y + amp * Math.sin(x / 210)]); return one(poly);
  };
  const tangle = (cx, cy, R, turns = 2.6, seed = 0) => {
    const poly = [];
    const first = (a) => [cx + R * (.62 * Math.sin(a + .3 + seed) + .3 * Math.sin(2.37 * a + 1.1) + .13 * Math.sin(5.3 * a + seed)),
      cy + R * .8 * (.6 * Math.cos(1.17 * a + seed) + .3 * Math.cos(2.9 * a + .4) + .12 * Math.cos(6.1 * a + 2))];
    const s = first(0);
    const ex = Math.min(2000, cx + R * 1.6), ey = 1130;
    for (let k = 0; k <= 40; k++) { const t = k / 40, e = 1 - (1 - t) * (1 - t); poly.push([ex + (s[0] - ex) * t, ey + (s[1] - ey) * e]); }
    for (let i = 1; i <= 1800; i++) poly.push(first(i / 1800 * Math.PI * 2 * turns));
    return one(poly);
  };
  const ecg = amp => {
    const y0 = 900, poly = [];
    for (let x = 2000; x >= -80; x -= 2) {
      const u = (((2000 - x) % 320) + 320) % 320 / 320;
      let y = 0;
      if (u > .30 && u < .38) y = -22 * Math.sin((u - .30) / .08 * Math.PI);
      else if (u >= .44 && u < .48) y = -170 * (u - .44) / .04;
      else if (u >= .48 && u < .53) y = -170 + 240 * (u - .48) / .05;
      else if (u >= .53 && u < .57) y = 70 - 70 * (u - .53) / .04;
      else if (u > .66 && u < .78) y = -30 * Math.sin((u - .66) / .12 * Math.PI);
      poly.push([x, y0 + y * amp]);
    }
    return one(poly);
  };
  const SHAPES = {
    logo() {
      const p = $('#road-src'); p.setAttribute('d', window.ROAD_D);
      const len = p.getTotalLength(), poly = [];
      for (let k = 0; k <= 1400; k++) { const q = p.getPointAtLength(len * k / 1400); poly.push([LX + q.x * LK, LY + q.y * LK]); }
      return one(poly);
    },
    tangleA: () => tangle(960, 560, 380),
    tangleB: () => tangle(960, 540, 420, 2.9, .7),
    tangleP1: () => tangle(560, 600, 330, 3.1, 1.4),
    tangleEnd: () => tangle(960, 560, 360, 2.4, 2.2),
    hz440: () => hz(440, 6),
    hz800: () => hz(800, 14),
    hz700: () => hz(700, 8),
    hz1010: () => hz(1012, 5),
    gap: () => many([[[1300, 445], [1020, 445]], [[900, 445], [620, 445]]]),
    ecg1: () => ecg(1),
    ecg0: () => ecg(0),
    scatter: () => many(APPS.map(([, x, y]) => { const p = []; for (let t = 0; t <= 40; t++) p.push([x + 110 - t * 5.5, y + 54 + 7 * Math.sin(t / 4 + x)]); return p; })),
    road: () => one(catmull([[2010, 950], [1800, 932], [1500, 958], [1200, 934], [900, 958], [600, 934], [300, 956], [60, 940], [-90, 950]])),
    flow: () => one(catmull([[2010, 690], [1700, 660], [1440, 710], [1150, 670], [860, 710], [560, 670], [260, 700], [-90, 680]])),
  };
  const cache = {};
  const shape = k => (cache[k] ||= SHAPES[k]());

  const STY = {
    mint: { color: '#8ff0c6', w: 7, op: 1, glow: .35 },
    road: { color: '#8ff0c6', w: 4, op: .9, glow: .25 },
    flow: { color: '#8ff0c6', w: 3, op: .55, glow: .2, flow: 1 },
    paper: { color: '#f2efe8', w: 3, op: .7, glow: .1 },
    ghost: { color: '#77756f', w: 3, op: .75, glow: 0 },
    ghostDim: { color: '#77756f', w: 3, op: .22, glow: 0 },
  };
  let morphTw;
  const curLine = { key: null, style: null };
  function setLine(spec, inst) {
    if (spec.key !== curLine.key) {
      curLine.key = spec.key;
      const target = shape(spec.key), from = L.pts.slice(), fb = L.breaks, tb = target.breaks;
      const adding = tb.length > fb.length, st = spec.stagger ?? .4, ease = gsap.parseEase(spec.ease || 'power3.inOut');
      morphTw && morphTw.kill();
      if (inst) { L.pts.set(target.pts); L.breaks = tb; render(); }
      else {
        const s = { p: 0 };
        morphTw = gsap.to(s, {
          p: 1, duration: spec.dur ?? 2, delay: spec.delay || 0, ease: 'none', onUpdate() {
            const P = s.p * (1 + st);
            for (let i = 0; i < N; i++) {
              const e = ease(Math.min(1, Math.max(0, P - st * i / (N - 1))));
              L.pts[2 * i] = from[2 * i] + (target.pts[2 * i] - from[2 * i]) * e;
              L.pts[2 * i + 1] = from[2 * i + 1] + (target.pts[2 * i + 1] - from[2 * i + 1]) * e;
            }
            L.breaks = adding ? (s.p > 0 ? tb : fb) : (s.p > .9 ? tb : fb);
            render();
          }
        });
      }
    }
    if (spec.style !== curLine.style) {
      curLine.style = spec.style;
      const o = STY[spec.style], d = inst ? 0 : 1.4;
      gsap.to(ln, { stroke: o.color, strokeWidth: o.w, opacity: o.op, duration: d });
      gsap.to(glow, { stroke: o.color, strokeWidth: o.w * 3.2, opacity: o.glow, duration: d });
      gsap.to(flow, { opacity: o.flow ? .7 : 0, duration: d });
    }
  }

  /* ---------------- generic reveal ---------------- */
  const IN = { opacity: 1, y: 0, filter: 'blur(0px)' };
  function reveal(el, inst, delay = 0) {
    gsap.killTweensOf(el);
    const words = el._words;
    if (words) {
      gsap.killTweensOf(words);
      gsap.set(el, { opacity: 1, y: 0, filter: 'none' });
      if (inst) gsap.set(words, IN);
      else gsap.fromTo(words, { opacity: 0, y: 34, filter: 'blur(14px)' }, { ...IN, duration: 1.1, stagger: .07, ease: 'power3.out', delay });
    } else if (inst) gsap.set(el, IN);
    else gsap.fromTo(el, { opacity: 0, y: 28, filter: 'blur(12px)' }, { ...IN, duration: 1.1, ease: 'power3.out', delay });
  }
  function conceal(el, inst) {
    gsap.killTweensOf(el); el._words && gsap.killTweensOf(el._words);
    if (inst) gsap.set(el, { opacity: 0 });
    else gsap.to(el, { opacity: 0, y: -16, filter: 'blur(10px)', duration: .55, ease: 'power2.in' });
  }

  /* ---------------- builders for dynamic DOM ---------------- */
  // apps (scattered + convergence)
  for (const host of $$('.apps')) for (const [n, x, y] of APPS) {
    const a = document.createElement('div'); a.className = 'app'; a.style.left = x + 'px'; a.style.top = y + 'px';
    a.innerHTML = `<span style="animation-delay:${-x % 5}s">${n}</span>`; host.appendChild(a);
  }
  // dot field: one advisor, hundreds of students
  const field = $('#dotfield');
  for (let r = 0; r < 12; r++) for (let c = 0; c < 18; c++) {
    const i = document.createElement('i'); i.style.left = (c * 43) + 'px'; i.style.top = (r * 44) + 'px';
    if (r === 5 && c === 8) i.className = 'adv';
    field.appendChild(i);
  }

  // product captions + node labels
  const STEPS = [
    ['اليوم الأول: عرّف Waypoint بنفسك', 'يقرأ الـ CV والـ GitHub والسجل الأكاديمي… وما يعتمد شيء إلا بموافقتك', 'التعريف'],
    ['خريطة طريق مبنية عليك', 'من مقرراتك واهتماماتك ووقتك وأهدافك', 'الخريطة'],
    ['…وفيها اللي يطلبه السوق اليوم', 'Agents، Tool Use، RAG… مو منهج 2019', 'السوق'],
    ['مدرّب يعرفك', 'يعرف خريطتك ومشاريعك… ويشرح من خلال اللي تعرفه', 'المدرّب'],
    ['ما يحل عنك… يتأكد إنك فهمت', 'أسئلة، تمارين، بطاقات مراجعة… داخل المحادثة', 'الفهم'],
    ['كل مرحلة تنتهي بمشروع حقيقي', 'مو بس تتعلم… تبني شيء تقدر توريه', 'المشاريع'],
    ['وكيل يشغّل مشروعك ويقيّمه بالأدلة', 'تقييم حقيقي لمشروع Agentic Tool Playground', 'التقييم'],
    ['فرص تناسبك… وناقصك يدخل خريطتك', 'شركات سعودية، مع سبب التوافق والمهارة الناقصة', 'الفرص'],
    ['سيرتك تنكتب من شغلك الفعلي', 'من بياناتك المؤكدة ومشاريعك المقيّمة… وتنزّلها PDF', 'السيرة'],
    ['ومو بس لطلاب الحاسب', 'طب، هندسة، أي تخصص: الخريطة والفرص والسيرة تتغيّر حسبك', 'كل التخصصات'],
  ];
  const PROD_MAP = [0, 1, 2, 3, 4, 4, 5, 6, 6, 7, 8, 9];
  const caps = STEPS.map(([t, p], i) => {
    const c = document.createElement('div'); c.className = 'cap item';
    c.innerHTML = `<div class="step">الخطوة ${i + 1} <span>من 10</span></div><h2 class="split">${t}</h2><p>${p}</p>`;
    $('#caps').appendChild(c); return c;
  });
  const roadPts = shape('road').pts;
  const nodeAt = x => { let best = 0; for (let i = 0; i < N; i++) if (Math.abs(roadPts[2 * i] - x) < Math.abs(roadPts[2 * best] - x)) best = i; return [roadPts[2 * best], roadPts[2 * best + 1]]; };
  const nodesG = $('#nodes'), SVGNS = 'http://www.w3.org/2000/svg';
  const nodes = STEPS.map((s, k) => {
    const [x, y] = nodeAt(1760 - k * 1600 / 9);
    const g = document.createElementNS(SVGNS, 'g'); g.setAttribute('class', 'node');
    g.innerHTML = `<circle class="h" cx="${x}" cy="${y}" r="16"/><circle class="o" cx="${x}" cy="${y}" r="10"/>`;
    nodesG.appendChild(g);
    const lab = document.createElement('div'); lab.className = 'nlabel'; lab.style.left = x + 'px'; lab.textContent = s[2];
    $('#nlabels').appendChild(lab);
    return { g, lab };
  });
  gsap.set(nodesG, { opacity: 0 });

  // team
  const MEMBERS = [
    ['أ', 'أنت', 'القائد', 'تنظيم · متطلبات', 'الهدف: قيادة فريق تقني'],
    ['س', 'سارة', 'Python', 'Python · Computer vision', 'الهدف: ML engineer'],
    ['ع', 'علي', 'Backend', 'Node.js · REST APIs', 'الهدف: تدريب Backend'],
    ['ن', 'نورة', 'UI/UX', 'Figma · React', 'الهدف: تصميم المنتجات'],
  ];
  const COLX = [1660, 1320, 980, 640];
  const TASKS = [
    ['Project charter', 0, 'القائد ينسّق'],
    ['Non-functional requirements', 1, '↗ تطوير: كتابة متطلبات', 1],
    ['Data model (ERD)', 2, 'قوته: REST APIs'],
    ['Use cases', 0, 'يكمّل الـ charter'],
    ['Report & search wireframes', 3, 'قوتها: Figma'],
    ['Interview 3 students', 3, '↗ تطوير: بحث المستخدم', 1],
  ];
  const memEls = MEMBERS.map(([k, n, r, sk, goal], i) => {
    const m = document.createElement('div'); m.className = 'member'; m.style.left = (COLX[i] - 150) + 'px';
    m.innerHTML = `<div class="av">${k}</div><div class="nm">${n}</div><div class="rl">${r}</div><div class="more"><b>${sk}</b>${goal}</div>`;
    $('#members').appendChild(m);
    if (i) {
      const z = document.createElement('div'); z.className = 'nothing'; z.style.left = (COLX[i] - 150) + 'px';
      z.textContent = 'لا شيء'; z.dataset.b = '0'; z.dataset.until = '0'; $('#s-team').appendChild(z);
    }
    return m;
  });
  const taskEls = TASKS.map(([t, , why, grow]) => {
    const e = document.createElement('div'); e.className = 'task';
    e.innerHTML = `${t.replace('&', '&amp;')}<span class="why${grow ? ' g' : ''}">${why}</span>`;
    $('#tasks').appendChild(e); return e;
  });
  function teamLayout(b, inst) {
    const d = inst ? 0 : 1.1;
    memEls.forEach(m => { m.classList.toggle('x', b >= 2); gsap.to(m, { opacity: b === 1 ? .28 : 1, duration: d }); });
    const per = [0, 0, 0, 0];
    taskEls.forEach((e, i) => {
      let x, y;
      if (b === 0) { x = COLX[0] - 150; y = 440 + i * 64; }
      else if (b <= 2) { x = COLX[i % 3] - 150; y = 790 + Math.floor(i / 3) * 70; }
      else { const m = TASKS[i][1]; x = COLX[m] - 150; y = 545 + per[m]++ * 94; }
      e.classList.toggle('r', b >= 3);
      gsap.to(e, { x, y, duration: d, ease: 'power3.inOut', delay: inst ? 0 : i * .06 });
    });
  }

  /* ---------------- scenes ---------------- */
  const bars = h => gsap.to(['#bar-t', '#bar-b'], { height: h, duration: 1.4, ease: 'power3.inOut' });
  const setMask = (img, m) => gsap.set(img, { '--m': m });
  let tipPulse;

  const scenes = [
    { id: 's-open', builds: 2, bars: 110,
      line: () => ({ key: 'logo', style: 'mint' }),
      notes: 'افتح بصمت. اضغط: الخط يرسم الطريق داخل الشعار… "هذا Waypoint. رفيقك من أول يوم في الجامعة لين التخرج."',
      reset() { setMask('#logo-a', -15); gsap.set(['#tag-a', '#cred-a', '#ripple-a'], { opacity: 0 }); gsap.set('#ripple-a', { left: DOT[0], top: DOT[1] }); },
      on(b, inst) {
        const tag = $('#tag-a');
        if (b === 0) {
          L.draw = 0; render(); setMask('#logo-a', -15);
          gsap.set(tip, { opacity: 1 }); tipPulse && tipPulse.kill();
          tipPulse = gsap.fromTo(tip, { attr: { r: 9 } }, { attr: { r: 18 }, duration: 1.1, yoyo: true, repeat: -1, ease: 'sine.inOut' });
          gsap.to('#hint', { opacity: 1, duration: .8 });
          return;
        }
        tipPulse && tipPulse.kill(); gsap.to('#hint', { opacity: 0, duration: .4 });
        if (inst) {
          L.draw = 1; render(); setMask('#logo-a', 115); gsap.set(tip, { opacity: 0 });
          reveal(tag, true); gsap.set('#cred-a', { opacity: 1 }); return;
        }
        let m = -15;
        const tl = gsap.timeline();
        tl.to(tip, { attr: { r: 12 }, duration: .3 })
          .to(L, { draw: 1, duration: 4.4, ease: 'power2.inOut', onUpdate() {
            render();
            const x = +tip.getAttribute('cx');
            m = Math.max(m, (x - LX) / 1400 * 100 + 4); setMask('#logo-a', m);
          } }, '<')
          .to('#logo-a', { '--m': 115, duration: .6 })
          .to(tip, { opacity: 0, duration: .5 }, '<')
          .fromTo('#ripple-a', { opacity: .9, scale: .4 }, { opacity: 0, scale: 3.2, duration: 1.4, ease: 'power2.out' }, '<')
          .add(() => reveal(tag, false), '-=1')
          .to('#cred-a', { opacity: 1, duration: 1.2 }, '+=.5');
      } },

    { id: 's-year', builds: 2, bars: 0,
      line: b => ({ key: b ? 'tangleB' : 'tangleA', style: 'ghost', dur: b ? 2.4 : 2.6, stagger: .5 }),
      notes: '"أنا في السنة الثالثة… وما زلت ضايع." وقفة. "والقصة مو قصتي بس."' },

    { id: 's-four', builds: 1, bars: 0,
      line: () => ({ key: 'hz440', style: 'ghost' }),
      notes: 'أربع مشاكل يعيشها كل طالب — مرّ عليها بسرعة، كل وحدة لها مشهد.',
      on(b, inst) { if (!inst) gsap.fromTo('#s-four .card', { opacity: 0, y: 40, filter: 'blur(10px)' }, { ...IN, duration: 1, stagger: .15, delay: .3, ease: 'power3.out' }); } },

    { id: 's-p1', builds: 4, bars: 0,
      line: b => ({ key: 'tangleP1', style: b === 3 ? 'ghostDim' : 'ghost' }),
      notes: 'ثلاث أسئلة ما لها جواب… ومرشد واحد لمئات الطلاب.',
      on(b, inst) {
        if (b === 3 && !inst) gsap.fromTo('#dotfield i', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: .5, stagger: { each: .004, from: 'random' }, ease: 'back.out(2)' });
        else gsap.set('#dotfield i', { opacity: 1, scale: 1 });
      } },

    { id: 's-p2', builds: 4, bars: 0,
      line: () => ({ key: 'gap', style: 'ghost', dur: 2.2 }),
      notes: 'المنهج 2019، السوق 2026. الفجوة بينهم هي اللي نعيشها.' },

    { id: 's-p3', builds: 5, bars: 0,
      line: b => ({ key: b ? 'ecg0' : 'ecg1', style: b ? 'ghostDim' : 'ghost', dur: b ? 1.6 : 2.2, stagger: b ? .2 : .4 }),
      notes: '"حل لي الـ lab بسرعة" — "تفضل" — "وبعدين؟" الخط يموت هنا. ثم الثلاث نقاط.' },

    { id: 's-p4', builds: 2, bars: 0,
      line: () => ({ key: 'scatter', style: 'ghost', dur: 1.8 }),
      notes: 'سبع تطبيقات، ولا واحد يعرفك. وكل مرة تبدأ من الصفر.' },

    { id: 's-one', builds: 2, bars: 0,
      line: () => ({ key: 'hz800', style: 'mint', dur: 2.4, delay: .3, stagger: .25 }),
      notes: 'اللحظة: كل شيء يتجمّع. "مدرّب واحد. خريطة طريق واحدة. رحلتك الجامعية كلها."',
      reset() { $$('#apps-one .app').forEach((a, i) => gsap.set(a, { left: APPS[i][1], top: APPS[i][2], opacity: 1, scale: 1 })); gsap.set('#logo-sm', { opacity: 0 }); },
      on(b, inst) {
        if (b) return;
        const apps = $$('#apps-one .app');
        if (inst) { gsap.set(apps, { opacity: 0 }); gsap.set('#logo-sm', { opacity: 1, y: 0, filter: 'none' }); return; }
        gsap.to(apps, { left: 960, top: 540, opacity: 0, scale: .3, duration: 1.2, stagger: .07, ease: 'power3.in', delay: .2 });
        gsap.fromTo('#logo-sm', { opacity: 0, y: 20, filter: 'blur(16px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.4, delay: 1.2, ease: 'power3.out' });
      } },

    { id: 's-prod', builds: PROD_MAP.length, bars: 0,
      line: () => ({ key: 'road', style: 'road', dur: 2 }),
      notes: 'عشر محطات على الطريق. لكل خطوة جملة واحدة — خلّ الشاشة تتكلم.',
      enter() { gsap.to(nodesG, { opacity: 1, duration: 1.2, delay: .8 }); },
      leave() { gsap.to(nodesG, { opacity: 0, duration: .6 }); $$('#s-prod video').forEach(v => v.pause()); },
      reset() { gsap.set('#s-prod .shot', { opacity: 0 }); gsap.set(caps, { opacity: 0 }); this._step = -1; },
      on(b, inst) {
        const step = PROD_MAP[b];
        nodes.forEach((n, k) => {
          n.g.classList.toggle('past', k < step); n.g.classList.toggle('now', k === step);
          n.lab.classList.toggle('past', k < step); n.lab.classList.toggle('now', k === step);
        });
        if (step !== this._step) {
          const prev = this._step; this._step = step;
          $$('#s-prod .shot').forEach(s => {
            const on = +s.dataset.s === step, v = $('video', s);
            gsap.killTweensOf(s);
            if (on) {
              gsap.to(s, { opacity: 1, duration: inst ? 0 : .9 });
              if (v) { v.currentTime = 0; v.play().catch(() => {}); }
              const img = $(':scope > img:not(.dimmed)', s);
              if (img && !inst) img.classList.contains('zoom')
                ? gsap.fromTo(img, { scale: 1 }, { scale: 1.9, duration: 3.2, ease: 'power2.inOut', delay: .6 })
                : gsap.fromTo(img, { scale: 1.0 }, { scale: 1.07, duration: 14, ease: 'none' });
              if (img && inst && img.classList.contains('zoom')) gsap.set(img, { scale: 1.9 });
            } else {
              gsap.to(s, { opacity: 0, duration: inst ? 0 : .7 });
              if (v) v.pause();
            }
          });
          caps.forEach((c, k) => {
            if (k === step) { gsap.set(c, { opacity: 1 }); reveal($('h2', c), inst, .25); gsap.fromTo([$('.step', c), $('p', c)], { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: inst ? 0 : .9, delay: inst ? 0 : .5, stagger: .15 }); }
            else if (k === prev) gsap.to(c, { opacity: 0, duration: inst ? 0 : .45 });
            else gsap.set(c, { opacity: 0 });
          });
          if (!inst) gsap.fromTo('#frame', { rotateY: -10 }, { rotateY: -6, duration: 1.4, ease: 'power3.out' });
        }
        // sub-builds
        $('#q-ok').classList.toggle('ok', b >= 5);
        if (b === 7 || b === 8) {
          const ring = $('#ring-fg'), sc = $('#score');
          if (b === 7 && !inst) {
            gsap.fromTo(ring, { attr: { 'stroke-dashoffset': 100 } }, { attr: { 'stroke-dashoffset': 18 }, duration: 2, delay: .6, ease: 'power3.out' });
            const o = { v: 0 }; gsap.to(o, { v: 82, duration: 2, delay: .6, ease: 'power3.out', onUpdate: () => sc.textContent = Math.round(o.v) });
          } else { gsap.set(ring, { attr: { 'stroke-dashoffset': 18 } }); sc.textContent = 82; }
          const ch = $$('#checks div'), br = $$('#bars i');
          if (b === 8) {
            if (inst) gsap.set(ch, { opacity: 1 }); else gsap.fromTo(ch, { opacity: 0, x: -14 }, { opacity: 1, x: 0, stagger: .22, duration: .5 });
            br.forEach((i, k) => setTimeout(() => i.style.setProperty('--s', 1), inst ? 0 : 900 + k * 150));
          } else { gsap.set(ch, { opacity: 0 }); br.forEach(i => i.style.setProperty('--s', 0)); }
        }
      } },

    { id: 's-team', builds: 7, bars: 0,
      line: () => ({ key: 'hz1010', style: 'paper' }),
      notes: 'المشاريع الجماعية: واحد يشتغل والباقي يتفرجون → ملف المشروع → Hermes يعرف الفريق → توزيع عادل → الفريق يصوّت → يشتغل معكم → يتابعكم. "بالـ AI… مو ضده."',
      reset() { gsap.set(memEls, { opacity: 0 }); gsap.set(taskEls, { opacity: 0 }); },
      on(b, inst, prevB) {
        if (prevB === -1 && !inst) {
          teamLayout(b, true);
          gsap.fromTo(memEls, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .9, stagger: .12, delay: .3 });
          gsap.fromTo(taskEls, { opacity: 0 }, { opacity: 1, duration: .6, stagger: .08, delay: .9 });
        } else { gsap.set(memEls, { y: 0 }); gsap.set(taskEls, { opacity: 1 }); teamLayout(b, inst); }
        const rows = $$('#rows div');
        if (b === 1 && !inst) gsap.fromTo(rows, { opacity: 0, x: 20 }, { opacity: 1, x: 0, stagger: .35, delay: .8, duration: .6 });
        else gsap.set(rows, { opacity: 1, x: 0 });
        const votes = $$('#votes span');
        votes.forEach(v => v.classList.remove('ok')); gsap.set('#stamp', { opacity: 0 });
        if (b === 4) {
          const yes = [0, 1, 3];
          if (inst) { yes.forEach(i => votes[i].classList.add('ok')); gsap.set('#stamp', { opacity: 1 }); }
          else {
            yes.forEach((i, k) => setTimeout(() => votes[i].classList.add('ok'), 1000 + k * 550));
            gsap.to('#stamp', { opacity: 1, duration: .6, delay: 2.9 });
          }
        }
      } },

    { id: 's-arch', builds: 5, bars: 0,
      line: () => ({ key: 'flow', style: 'flow', dur: 2 }),
      notes: 'تحت الغطاء: المصادر → Jev يفلتر ويحمي → SQLite مصدر الحقيقة → Hermes → التطبيق. "Hermes يقترح… الطالب يقرر."' },

    { id: 's-end', builds: 5, bars: b => b >= 2 ? 110 : 0,
      line: b => b === 0 ? { key: 'tangleEnd', style: 'ghost', stagger: .5 } : b === 1 ? { key: 'hz700', style: 'paper', dur: 2.2 } : { key: 'logo', style: 'mint', dur: 2.6, stagger: .3 },
      notes: '"لو كان عندي Waypoint من أول يوم… ما كنت بوصل السنة الثالثة ضايع." الخط يرجع للشعار. "الخريطة الي كلنا نستحقها." شكراً.',
      reset() { setMask('#logo-b', -15); gsap.set('#ripple-b', { left: DOT[0], top: DOT[1], opacity: 0 }); },
      on(b, inst, prevB) {
        if (b < 2) { gsap.to('#logo-b', { '--m': -15, duration: inst ? 0 : .6 }); return; }
        if (inst || prevB >= 2) { setMask('#logo-b', 115); return; }
        gsap.fromTo('#logo-b', { '--m': -15 }, { '--m': 115, duration: 1.8, delay: 1.9, ease: 'power2.inOut' });
        gsap.fromTo('#ripple-b', { opacity: .9, scale: .4 }, { opacity: 0, scale: 3.2, duration: 1.4, delay: 3.4, ease: 'power2.out' });
      } },
  ];

  /* ---------------- controller ---------------- */
  scenes.forEach(s => { s.el = document.getElementById(s.id); $$('.split', s.el).forEach(e => { splitWords(e); e._words = $$('.w', e); }); });
  $$('#caps .split').forEach(e => { splitWords(e); e._words = $$('.w', e); });
  const TOTAL = scenes.reduce((a, s) => a + s.builds, 0);
  let si = -1, bi = 0;

  function applyBuild(sc, b, inst) {
    $$('[data-b]', sc.el).forEach(el => {
      const n = +el.dataset.b, u = el.dataset.until, vis = b >= n && (u === undefined || b <= +u);
      if (el._vis === vis) return;
      el._vis = vis;
      vis ? reveal(el, inst, +(el.dataset.delay || 0) + .15) : conceal(el, inst);
    });
  }

  function go(s, b, inst) {
    const sc = scenes[s];
    let prevB = bi;
    if (s !== si) {
      const old = scenes[si];
      if (old) {
        old.leave && old.leave();
        gsap.killTweensOf(old.el);
        gsap.to(old.el, { opacity: 0, scale: .985, filter: 'blur(10px)', duration: inst ? 0 : .7, ease: 'power2.in', onComplete: () => old.el.classList.remove('on') });
      }
      $$('[data-b]', sc.el).forEach(el => { el._vis = false; gsap.killTweensOf(el); gsap.set(el, { opacity: 0 }); });
      sc.reset && sc.reset();
      sc.el.classList.add('on');
      gsap.killTweensOf(sc.el);
      gsap.fromTo(sc.el, { opacity: 0, scale: 1.02, filter: 'blur(14px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: inst ? 0 : 1.1, delay: inst ? 0 : .35, ease: 'power2.out', clearProps: 'filter,transform' });
      sc.enter && sc.enter();
      prevB = -1;
      if (s > 0) { tipPulse && tipPulse.kill(); gsap.killTweensOf(L); gsap.to(tip, { opacity: 0, duration: inst ? 0 : .4 }); L.draw = 1; render(); }
    }
    si = s; bi = b;
    const barH = typeof sc.bars === 'function' ? sc.bars(b) : sc.bars;
    inst ? gsap.set(['#bar-t', '#bar-b'], { height: barH }) : bars(barH);
    setLine(sc.line(b), inst);
    applyBuild(sc, b, inst);
    sc.on && sc.on(b, inst, prevB);
    status();
  }

  function next() {
    startClock();
    const sc = scenes[si];
    if (bi < sc.builds - 1) go(si, bi + 1, false);
    else if (si < scenes.length - 1) go(si + 1, 0, false);
  }
  function prev() {
    if (bi > 0) go(si, bi - 1, true);
    else if (si > 0) go(si - 1, scenes[si - 1].builds - 1, true);
  }

  /* notes + clock */
  let t0 = 0, clock;
  function startClock() {
    if (t0) return; t0 = Date.now();
    clock = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $('#n-time').textContent = `${String(s / 60 | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 500);
  }
  function status() {
    const done = scenes.slice(0, si).reduce((a, s) => a + s.builds, 0) + bi + 1;
    $('#progress').style.width = (done / TOTAL * 100) + '%';
    $('#n-pos').textContent = `scene ${si + 1}/${scenes.length} · build ${bi + 1}/${scenes[si].builds} · ${done}/${TOTAL}`;
    $('#n-txt').textContent = scenes[si].notes || '';
  }

  addEventListener('keydown', e => {
    if (e.repeat && !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') go(0, 0, true);
    else if (k === 'End') go(scenes.length - 1, scenes[scenes.length - 1].builds - 1, true);
    else if (k === 'n' || k === 'N') $('#notes').classList.toggle('on');
    else if (k === 'f' || k === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  });
  addEventListener('click', next);
  addEventListener('contextmenu', e => { e.preventDefault(); prev(); });
  let idle; addEventListener('mousemove', () => { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('idle'), 1800); });

  // debug / QA hook: jump straight to a beat (?s=8&b=3)
  window.deck = { go: (s, b = 0) => go(s, b, true), next, prev, scenes };

  const q = new URLSearchParams(location.search);
  L.pts.set(shape('logo').pts); render();
  go(0, 0, true);
  if (q.has('s')) go(+q.get('s'), +(q.get('b') || 0), true);
})();
