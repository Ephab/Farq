// Fictional teaching data, confined to an isolated browser during capture.
export const filename = 'Lecture-04-Probability.pdf';
const text = 'Probability: two fair coin tosses have four equally likely outcomes: HH, HT, TH, TT. Exactly one head occurs in HT and TH. Its probability is 2/4 = 1/2. Independent events do not affect each other.';
const now = Date.UTC(2026,9,4,9);
export const studyLibrary = {
  decks: [{ id:'pitch-lecture',fileName:filename,kind:'pdf',units:2,chars:text.length,text,uploadedAt:now }],
  quizzes:[{ id:'pitch-quiz',deckIds:['pitch-lecture'],deckName:filename,difficulty:'Easy',model:'demo-fixture',createdAt:now,
    questions:[{ id:'pitch-coin',type:'mcq',question:'عند رمي عملة عادلة مرتين، ما احتمال ظهور الصورة مرة واحدة فقط؟',options:['1/4','1/2','3/4','1'],answer:'1/2',explanation:'النتائج أربع: صورة–صورة، صورة–كتابة، كتابة–صورة، كتابة–كتابة. نتيجتان تحققان الشرط، لذلك الاحتمال 2/4 = 1/2.',source:'Lecture 04 · Probability' }] }],
  extensions:[{ id:'pitch-explanation',deckId:'pitch-lecture',deckName:filename,deckKind:'pdf',topic:'الاحتمالات من الفكرة إلى التطبيق',createdAt:now,
    slides:[{title:'نفهم قبل أن نحسب',layout:'bullets',kicker:'مراجعة المحاضرة',bullets:['حدّد جميع النتائج الممكنة أولًا.','اختر النتائج التي تحقق الشرط.','اقسم عددها على عدد النتائج المتساوية الاحتمال.']},
      {title:'رمي عملة مرتين',layout:'bullets',bullets:['أربع نتائج متساوية الاحتمال.','ظهور الصورة مرة واحدة: نتيجتان من أربع.','الاحتمال = 1/2.'],speakerNotes:'اطلب من الطالب تسمية النتائج الأربع قبل عرض الإجابة.'}] }],
};
export const studyFiles = [
  {id:'pitch-probability',title:'المحاضرة 04 · أساسيات الاحتمالات',filename,mime_type:'application/pdf',size:2400,path:'Lectures/Lecture-04-Probability.pdf',text_indexed:true,course_id:'pitch-math',course:'STAT 201 · الاحتمالات والإحصاء',term:'2026 · الفصل الأول',term_id:'2026-1',status:'current',is_slide:true},
  {id:'pitch-distribution',title:'المحاضرة 05 · المتغيرات العشوائية',filename:'Lecture-05-Random-Variables.pdf',mime_type:'application/pdf',size:2400,path:'Lectures/Lecture-05-Random-Variables.pdf',text_indexed:true,course_id:'pitch-math',course:'STAT 201 · الاحتمالات والإحصاء',term:'2026 · الفصل الأول',term_id:'2026-1',status:'current',is_slide:true},
  {id:'pitch-python',title:'المحاضرة 03 · مدخل إلى Python',filename:'Lecture-03-Python.pdf',mime_type:'application/pdf',size:2400,path:'Lectures/Lecture-03-Python.pdf',text_indexed:true,course_id:'pitch-cs',course:'CS 101 · البرمجة',term:'2026 · الفصل الأول',term_id:'2026-1',status:'current',is_slide:true},
];
export const creationQuestions = [studyLibrary.quizzes[0].questions[0],
  {id:'pitch-space',type:'mcq',question:'كم نتيجة متساوية الاحتمال توجد عند رمي عملة مرتين؟',options:['2','3','4','8'],answer:'4',explanation:'فضاء العينة هو: صورة–صورة، صورة–كتابة، كتابة–صورة، كتابة–كتابة.',source:'Lecture 04 · Probability'},
  {id:'pitch-heads',type:'mcq',question:'ما احتمال ظهور الصورة في الرميتين معًا؟',options:['1/4','1/2','3/4','1'],answer:'1/4',explanation:'نتيجة واحدة من النتائج الأربع تحقق الشرط.',source:'Lecture 04 · Probability'},
  {id:'pitch-independence',type:'mcq',question:'هل نتيجة الرمية الأولى تغيّر احتمال الرمية الثانية لعملة عادلة؟',options:['نعم دائمًا','لا، الرميتان مستقلتان','فقط إذا ظهرت الصورة','لا يمكن تحديده'],answer:'لا، الرميتان مستقلتان',explanation:'نتيجة الرمية السابقة لا تؤثر في الرمية التالية.',source:'Lecture 04 · Probability'},
  {id:'pitch-atleast',type:'mcq',question:'ما احتمال ظهور الصورة مرة واحدة على الأقل عند رمي العملة مرتين؟',options:['1/4','1/2','3/4','1'],answer:'3/4',explanation:'ثلاث نتائج من الأربع تحتوي على الصورة: صورة–صورة، صورة–كتابة، كتابة–صورة.',source:'Lecture 04 · Probability'},
];
// A small, valid PDF fixture. Original course files are never fetched for the take.
export function lecturePdf() {
  const slide=(title,subtitle,lines)=>`0.99 0.98 0.96 rg 0 0 1440 810 re f\n0.02 0.58 0.62 rg 0 748 1440 62 re f\nBT /F1 25 Tf 1 1 1 rg 65 770 Td (STAT 201 / DEMO LECTURE 04) Tj ET\nBT /F1 66 Tf 0.09 0.08 0.17 rg 85 610 Td (${title}) Tj ET\nBT /F1 30 Tf 0.3 0.28 0.4 rg 85 538 Td (${subtitle}) Tj ET\n${lines.map((line,i)=>`BT /F1 38 Tf 0.09 0.08 0.17 rg 105 ${405-i*88} Td (${line}) Tj ET`).join('\n')}\nBT /F1 23 Tf 0.4 0.4 0.5 rg 85 60 Td (Fictional course material for the Waypoint presentation) Tj ET`;
  const pages=[slide('Probability starts with possibilities','List the sample space before calculating.',['Two fair coin tosses: HH, HT, TH, TT','Exactly one head: HT or TH','Probability: 2 / 4 = 1 / 2']),slide('Independent events','One outcome does not change the next.',['A fair coin has two equally likely outcomes.','Two tosses have four equally likely outcomes.','Check your reasoning, then apply the formula.'])];
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((stream,i)=>{objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1440 810] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);});
  let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
