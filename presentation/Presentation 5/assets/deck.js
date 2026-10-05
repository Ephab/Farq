/* A 120-second pitch: one click per slide, a cinematic road, and one logo dot.
   Transitions belong to the allotted speaking time; they never add extra beats. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const scene = window.WaypointScene;
  const slides = scene.slides;
  const stage = $('#stage');
  const requested = location.hash.slice(1);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const durations = slides.map(s => Number(s.dataset.seconds));
  const total = durations.reduce((a, b) => a + b, 0);
  const starts = durations.map((_, i) => durations.slice(0, i).reduce((a, b) => a + b, 0));
  let cur = 0, transition = null, firstStarted = null, auto = false, autoTimer = null;
  let movingTimer = null, statTween = null, storyTween = null;
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const notes = {
    title: 'هذا Waypoint: رفيق الطالب من أول يوم في الجامعة لين التخرّج والتدريب.',
    direction: 'أول مشكلة: نضيع. مواد ومواعيد، وما نعرف وش نتعلم بعدها ولا كيف ترتبط المواد بهدفنا. والثانية: المنهج يعلّم الأساس، بس السوق يتغيّر أسرع منه.',
    practice: 'الثالثة: نعرف المادة، بس البناء والتعاون والتسليم في بيئة حقيقية شيء ثاني. والرابعة: الـ AI يخلّص الشغل… وإحنا ما نتعلم.',
    apps: 'الخامسة: تطبيقات كثيرة ولا واحد يعرفنا؛ كل مرة نفس الملفات ونفس الشرح. والسادسة: التدريب التعاوني نبدأ ندوّر عليه متأخر، وما نعرف وش ينقصنا.',
    evidence: 'والأرقام تأكد: 48% من الخريجين مو جاهزين حتى يقدّمون. 39% من المهارات بتتغيّر بحلول 2030. و95% من الطلاب يستخدمون الذكاء الاصطناعي في دراستهم.',
    solution: 'الحل: Waypoint، رفيق واحد لكل رحلتك. داخله Hermes: يتعلّم من اللي تؤكّده، يوجّهك، ويقترح… وأنت اللي تقرر.',
    'sol-a': 'للضياع: خريطة تتكيّف معك من مقرراتك واهتماماتك ووقتك وهدفك؛ خطوة واضحة اليوم، وأي تعديل ينتظر موافقتك. وللمنهج: ما نستبدله، نكمّله بمهارات اليوم مثل Git وDocker وأدوات الـ AI.',
    'sol-b': 'للفجوة: كل مسار ينتهي بمشروع تطوّره مع Hermes ويُقيَّم في بيئة معزولة، فيصير تقدّمك دليل. وللـ AI: Hermes مدرّب مو بديل؛ يشرح ويسأل ويخليك تجرّب، وفي الفريق يوزّع الشغل والفريق يقرر.',
    'sol-c': 'للسياق: ملف واحد يعرفك، ويشرح لك الجديد بلغة اللي تعرفه، وما يعتمد شيء بدون موافقتك. وللتدريب: نطابقك مع فرص سعودية، ونحوّل اللي ينقصك لخطوات في خريطتك قبل ما تقدّم.',
    closing: 'Waypoint يخلّي خطوتك الجاية أوضح. شكرًا.',
  };

  const fit = () => stage.style.setProperty('--fit', Math.min(innerWidth / 2090, innerHeight / 1080));
  addEventListener('resize', fit); fit();
  function videos(i, play = true) {
    slides.forEach((slide, j) => slide.querySelectorAll('video').forEach(video => {
      if (j !== i || !play || reduce) { video.pause(); return; }
      video.preload = 'auto'; video.loop = true; video.currentTime = 0;
      video.play().catch(() => { /* the local poster remains visible */ });
    }));
    // Decode only the visible demo; warm the next source without loading the full library.
    slides[i + 1]?.querySelectorAll('video').forEach(video => { video.preload = 'metadata'; });
  }
  function cleanMoments() {
    statTween?.kill(); statTween = null; storyTween?.kill(); storyTween = null;
  }
  function stats(instant) {
    const els = [...$('#evidence').querySelectorAll('.stat-number')];
    if (instant || reduce) { els.forEach(el => el.innerHTML = `${el.dataset.value}<span>%</span>`); return; }
    const counter = { t: 0 };
    statTween = gsap.to(counter, { t: 1, duration: .8, ease: 'power2.out', onUpdate: () => els.forEach(el => el.innerHTML = `${Math.round(Number(el.dataset.value) * counter.t)}<span>%</span>`) });
  }
  function moment(i, instant) {
    const id=slides[i].id;if(id==='evidence')stats(instant);
    const targets=id==='direction'?['.question-bubble','.campus-island','.late-stamp']:id==='practice'?['.gap-list li','.problem-chat .chat-msg']:id==='apps'?['.coop-late']:id==='value'?['.value-cards article']:id==='more'?['.extras-board article']:[];
    const nodes=targets.flatMap(s=>[...slides[i].querySelectorAll(s)]);if(!nodes.length)return;
    gsap.set(nodes,{clearProps:'opacity,transform'});if(instant||reduce)return;
    storyTween=gsap.timeline();
    if(id==='direction'){
      storyTween.from('.question-bubble',{y:14,opacity:0,duration:.4,stagger:.1,ease:'power2.out'},0);
      storyTween.from('.campus-island',{y:18,opacity:0,duration:.45,stagger:.1,ease:'power2.out'},.2);
      storyTween.from('.late-stamp',{scale:1.7,opacity:0,duration:.4,ease:'back.out(1.4)'},.75);
    }else if(id==='practice')storyTween.from(nodes,{y:12,opacity:0,duration:.4,stagger:.22,ease:'power2.out'},0);
    else storyTween.from(nodes,{y:15,opacity:0,duration:.35,stagger:.08,ease:'power2.out'},0);
  }
  function metadata() {
    const elapsed = firstStarted === null ? 0 : (performance.now() - firstStarted) / 1000;
    $('#notes-meta').textContent = `${cur + 1} / ${slides.length} · ${fmt(starts[cur])}–${fmt(starts[cur] + durations[cur])} · المدة المقترحة ${durations[cur]}ث · elapsed ${fmt(elapsed)} / ${fmt(total)}`;
  }
  function update() {
    $('#slide-counter').textContent = `${cur + 1} / ${slides.length}`;
    $('#notes-text').textContent = notes[slides[cur].id];
    $('#announcer').textContent = `${cur + 1}. ${slides[cur].dataset.label}`;
    $('#prev').disabled = cur === 0; $('#next').disabled = cur === slides.length - 1;
    metadata();
    history.replaceState(null, '', `#${slides[cur].id}`);
  }
  function stopAuto() {
    auto = false; clearTimeout(autoTimer); autoTimer = null;
    $('#auto-toggle').setAttribute('aria-pressed', 'false'); $('#auto-toggle').textContent = '▶';
  }
  function schedule() {
    clearTimeout(autoTimer);
    if (!auto) return;
    autoTimer = setTimeout(() => {
      if (cur === slides.length - 1) stopAuto(); else go(cur + 1, { fromAuto: true });
    }, durations[cur] * 1000);
  }
  function go(to, { instant = false, fromAuto = false } = {}) {
    if (!Number.isInteger(to) || to < 0 || to >= slides.length || to === cur) return;
    if (!fromAuto) stopAuto();
    transition?.progress(1); transition?.kill(); cleanMoments();
    const previous = cur;
    videos(previous, false);
    transition = scene.go(previous, to, instant, () => { videos(to); moment(to, instant); });
    cur = to;
    if (firstStarted === null) firstStarted = performance.now();
    update(); schedule();
  }
  function toggleAuto() {
    if (auto) { stopAuto(); return; }
    // Rehearsal always starts a complete, timed 2:00 run.
    if (cur !== 0) go(0, { instant: true });
    firstStarted = performance.now(); auto = true;
    $('#auto-toggle').setAttribute('aria-pressed', 'true'); $('#auto-toggle').textContent = 'Ⅱ'; schedule(); metadata();
  }
  function fullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
  $('#prev').onclick = () => go(cur - 1); $('#next').onclick = () => go(cur + 1);
  $('#notes-toggle').onclick = () => { $('#notes').hidden = !$('#notes').hidden; };
  $('#auto-toggle').onclick = toggleAuto; $('#fullscreen').onclick = fullscreen;
  addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select,a,button') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.repeat) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(cur + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(cur - 1); }
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(slides.length - 1);
    else if (e.key.toLowerCase() === 'n') $('#notes').hidden = !$('#notes').hidden;
    else if (e.key.toLowerCase() === 'a') toggleAuto(); else if (e.key.toLowerCase() === 'f') fullscreen();
    else if (e.key === 'Escape') { stopAuto(); $('#notes').hidden = true; }
  });
  addEventListener('click', e => { if (!e.target.closest('button,a,#notes') && e.button === 0) go(cur + 1); });
  addEventListener('contextmenu', e => { if (!e.target.closest('a')) { e.preventDefault(); go(cur - 1); } });
  addEventListener('mousemove', () => {
    document.body.classList.add('controls-visible'); clearTimeout(movingTimer);
    movingTimer = setTimeout(() => document.body.classList.remove('controls-visible'), 1800);
  });
  let touchX = null;
  addEventListener('touchstart', e => { touchX = e.touches[0]?.clientX ?? null; }, { passive: true });
  addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 70) { e.preventDefault(); go(cur + (dx < 0 ? 1 : -1)); }
    touchX = null;
  }, { passive: false });
  setInterval(metadata, 1000);
  window.__deck = { beats: slides.map(s => s.id), durations, totalSeconds: total, get cur() { return cur; }, get auto() { return auto; }, go, jump: i => go(i, { instant: true }) };
  scene.set(0); update();
  if (requested && requested !== 'title') { const i = slides.findIndex(s => s.id === requested); if (i >= 0) go(i, { instant: true }); }
})();
