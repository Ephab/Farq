/* A 210-second pitch: one click per slide, a cinematic road, and one logo dot.
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
    title: 'هذا Waypoint، رفيق الطالب من أول يوم في الجامعة لين التخرّج. يجمع السياق ويربط التعلّم بالمشاريع والفرص.',
    direction: 'المواد والمواعيد ما تعطينا صورة كاملة. وقت الإرشاد محدود، وبعض المناهج متأخر عن أدوات السوق. نحتاج طريقًا يربط الأساس النظري بالتطبيق، ونبدأ الاستعداد للتدريب التعاوني مبكرًا.',
    apps: 'تطبيقات كثيرة، ونفس الملفات ونفس الشرح من الصفر. الـ AI يعطي حلًا جاهزًا، لكن الاختبار يحتاج فهمًا. وفي المشروع الجماعي تتفاوت المشاركة: واحد يشيل الشغل والبقية ما عندهم دور واضح. هذه بقية مشكلات العرض الأصلي، مجتمعة هنا.',
    evidence: '48% من الخريجين المشاركين في مسح Cengage الأمريكي لعام 2025 غير مستعدين حتى للتقديم على وظائف مبتدئة في مجالهم. يتوقع أصحاب العمل عالميًا تغيّر 39% من المهارات الأساسية بحلول 2030. و95% من 1,054 طالب بكالوريوس بدوام كامل في بريطانيا يستخدمون AI بطريقة واحدة على الأقل. النسب عن المسوح المذكورة، وليست عن طلاب السعودية.',
    value: 'القيمة المقترحة: للطالب خطة أوضح وتعلّم يثبت ومشاريع يقدر يعرضها. للجامعة إرشاد شخصي يساند المرشد. ولسوق العمل مهارات أقرب لاحتياج اليوم وأعمال تشهد عليها. هذه قيمة نهدف إليها، وليست نتائج مقاسة.',
    solution: 'نرجع للأدوات المتفرقة، ونجمع سياقها في Waypoint. هذا ليس اندماجًا بين الشركات، بل مكان واحد يربط بيانات الطالب وخريطته والمدرّب والمشاريع. Hermes يقترح، والطالب يقرر. الآن نشوف الاستخدام.',
    profile: 'يضيف الطالب السجل والـ CV والمشاريع أو يربط Blackboard. المعلومات المستوردة تبقى مقترحة، وتدخل الملف بعد مراجعتها والموافقة عليها. الملفات المرفوعة نفسها ما تنحفظ. هذه واجهة بياناتي الحالية.',
    roadmap: 'من الهدف والوقت والخبرة، تأتي خريطة بموضوعات ومصادر ومشاريع. حتى الخريطة الأولى تحتاج موافقتك. وإذا تغير هدفك، يجيك اقتراح جديد ويحافظ على المنجز والجاري. هنا خريطة الطالب التجريبي الحالية وتفاصيل موضوع منها.',
    coach: 'Hermes يعرف سياق الخريطة، ويشرح ويسأل. في السيناريو التدريبي المعروض يجاوب الطالب على سؤال داخل نفس المحادثة ويناقش السبب. الأسئلة والمراجعة والمؤقت كلها في نفس المكان. المحادثة هنا بيانات عرض محلية في الواجهة الحقيقية، وليست نتيجة تشغيل مباشر للنموذج.',
    study: 'ملفات Blackboard تظهر في قسم الاختبارات وقسم العروض. يختار الطالب المحاضرات ويكوّن اختبارًا: نشوف حركة أنبوب التقدّم، ثم الاختبار والإجابة والشرح. نفس المكتبة تستخدم لبناء شرائح تشرح الموضوع. المحاضرات وردود التوليد هنا بيانات عرض محلية في الواجهة الحالية، ومرحلة الانتظار مسرّعة للعرض؛ لم نشغّل نموذجًا مباشرًا أثناء التسجيل.',
    projects: 'التعلّم يتحول إلى مشروع له فكرة ومتطلبات ومخرجات. مساحة العمل والتقييم تساعدك تعرف اللي اكتمل واللي يحتاج تطوير، وترتبط الملاحظات بالأدلة. لا نزعم أن كل مشروع اختُبر بمتصفح أو طرفية.',
    team: 'في المشاريع الجماعية جمعنا المهام والمستندات والمواعيد والمحادثة في مساحة واحدة، مع واجهة محدثة. المعروض Campus Compass من مجموعة مشاريع خيالية جاهزة للتجربة المحلية. Hermes يقترح، والموافقة على اقتراحات الفريق تبقى للطلاب حسب صلاحياتهم.',
    career: 'ثم الفرص والسيرة: تراجع مصدر الفرصة والتوافق والفجوات، وتضيف المهارة الناقصة لخريطتك بعد الموافقة. تبني السيرة من معلوماتك المعتمدة وتصدر PDF أو DOCX. البريد الجامعي والمتابعات ومستجدات التعلم تكمل السياق. توفر أي فرصة يحتاج مراجعة مصدرها الرسمي وقت التقديم.',
    more: 'ومعها البريد الجامعي والمتابعات، ومستجدات التعلم المرتبطة بخريطتك، والرئيسية لتقدمك ومواعيدك، والتخصيص والروابط المتصلة. كلها من نفس المكان وبنفس السياق.',
    closing: 'Waypoint يجعل الخطوة الجاية أوضح، من أول يوم لين التخرّج. شكرًا لكم.',
  };

  const fit = () => stage.style.setProperty('--fit', Math.min(innerWidth / 1920, innerHeight / 1080));
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
    const targets=id==='direction'?['.question-bubble','.campus-island','.late-stamp']:id==='apps'?['.problem-chat .chat-msg']:id==='value'?['.value-cards article']:id==='more'?['.extras-board article']:[];
    const nodes=targets.flatMap(s=>[...slides[i].querySelectorAll(s)]);if(!nodes.length)return;
    gsap.set(nodes,{clearProps:'opacity,transform'});if(instant||reduce)return;
    storyTween=gsap.timeline();
    if(id==='direction'){
      storyTween.from('.question-bubble',{y:14,opacity:0,duration:.4,stagger:.1,ease:'power2.out'},0);
      storyTween.from('.campus-island',{y:18,opacity:0,duration:.45,stagger:.1,ease:'power2.out'},.2);
      storyTween.from('.late-stamp',{scale:1.7,opacity:0,duration:.4,ease:'back.out(1.4)'},.75);
    }else if(id==='apps')storyTween.from(nodes,{y:12,opacity:0,duration:.4,stagger:.3,ease:'power2.out'},0);
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
    // Rehearsal always starts a complete, timed 3:30 run.
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
