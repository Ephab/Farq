"""CPU-only, no-training comparison. Uses synthetic/publicly supplied text, never mailboxes."""
import argparse
import json
import os
from pathlib import Path
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))
MODEL = "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli"
REVISION = "0a71e92a985b6e1ad1828cf67ce9c459639c1dca"
LABELS = {
    "coursework": "This email is about university coursework, assignments, exams or class schedules.",
    "administration": "This email is about university registration, tuition fees, student records or required administration.",
    "opportunity": "This email offers a student an internship, scholarship, research placement or educational event.",
    "promotion": "This email is commercial advertising, a sales offer or a product marketing newsletter.",
    "personal": "This email is a personal or social conversation unrelated to university business.",
}
CONCISE_LABELS = dict(zip(LABELS, ["This email is about university coursework, assignments, exams or lectures.",
    "This email is about university administration, student registration or tuition payments.",
    "This email is about student opportunities, internships, scholarships or research placements.",
    "This email is about commercial advertising, product promotions or sales.",
    "This email is about personal conversations, family or friends."]))
# Fixed fixtures and descriptions before measuring; not training data or a held-out dataset.
CASES = [
    ("exam-en", "en", "coursework", "Final exam moved", "Your calculus final exam is now on Thursday at 9 am in room 201. Bring your student card."),
    ("assignment-en", "en", "coursework", "Project submission", "Submit the computer vision assignment and source code by Sunday. This project counts for 30 percent of your course grade."),
    ("fees-en", "en", "administration", "Tuition payment", "Your tuition payment is outstanding. Settle the balance through the student portal before registration closes."),
    ("records-en", "en", "administration", "Verify student details", "The registrar requires you to confirm your contact details in the university portal this week."),
    ("internship-en", "en", "opportunity", "Summer research internship", "The university AI lab invites undergraduate applications for a paid summer research internship. Apply by Friday."),
    ("scholarship-en", "en", "opportunity", "Scholarships open", "Applications for the university merit scholarship are now open to eligible students. Submit your transcript and application."),
    ("sale-en", "en", "promotion", "Upgrade today", "Get 40 percent off our premium productivity app. Upgrade your subscription today. This limited-time offer ends tonight."),
    ("newsletter-en", "en", "promotion", "A better way to work", "Discover our new business software features. Buy the annual plan to unlock advanced reports. Start your free trial today."),
    ("personal-en", "en", "personal", "Lunch tomorrow?", "Hi, are you free for lunch tomorrow? We could meet at the cafe near your house. Let me know!"),
    ("family-en", "en", "personal", "Weekend dinner", "Your cousin is visiting this weekend. We are having dinner at home on Saturday. Can you come?"),
    ("exam-ar", "ar", "coursework", "تغيير موعد الاختبار النهائي", "تم تغيير موعد الاختبار النهائي لمقرر الرياضيات إلى يوم الخميس الساعة التاسعة صباحا في القاعة ٢٠١. يرجى إحضار البطاقة الجامعية."),
    ("assignment-ar", "ar", "coursework", "تسليم مشروع المقرر", "يرجى تسليم مشروع مقرر الرؤية الحاسوبية والكود البرمجي قبل يوم الأحد. يمثل المشروع ثلاثين بالمئة من الدرجة النهائية."),
    ("fees-ar", "ar", "administration", "الرسوم الدراسية", "لم يتم سداد الرسوم الدراسية حتى الآن. يرجى سداد المبلغ عبر بوابة الطالب قبل إغلاق التسجيل."),
    ("records-ar", "ar", "administration", "تحديث بيانات الطالب", "تطلب عمادة القبول والتسجيل تأكيد بيانات التواصل الخاصة بك في البوابة الجامعية خلال هذا الأسبوع."),
    ("internship-ar", "ar", "opportunity", "فرصة تدريب بحثي صيفي", "يعلن مختبر الذكاء الاصطناعي بالجامعة عن تدريب بحثي صيفي مدفوع لطلاب البكالوريوس. آخر موعد للتقديم يوم الجمعة."),
    ("scholarship-ar", "ar", "opportunity", "منحة دراسية للمتفوقين", "فتح باب التقديم على منحة التفوق الجامعية للطلاب المستوفين للشروط. يرجى إرسال السجل الأكاديمي وطلب المنحة."),
    ("sale-ar", "ar", "promotion", "عرض خاص لفترة محدودة", "احصل على خصم أربعين بالمئة على الاشتراك السنوي في تطبيق الإنتاجية. قم بترقية حسابك الآن قبل انتهاء العرض الليلة."),
    ("newsletter-ar", "ar", "promotion", "اكتشف مزايا برنامجنا", "تعرف على المزايا الجديدة لبرنامج إدارة الأعمال. اشتر الخطة السنوية للحصول على التقارير المتقدمة وابدأ تجربتك المجانية اليوم."),
    ("personal-ar", "ar", "personal", "الغداء غدا", "مرحبا، هل أنت متفرغ لتناول الغداء غدا؟ يمكننا اللقاء في المقهى القريب من منزلك. أخبرني إذا كان الوقت مناسبا."),
    ("family-ar", "ar", "personal", "عشاء نهاية الأسبوع", "سيزورنا ابن عمك في نهاية الأسبوع. سنجتمع للعشاء في المنزل يوم السبت. هل يمكنك الحضور؟"),
    ("zoom-user", "en", "promotion", "Start using My Notes", "Stop dreading meeting follow-ups. Start using My Notes. Ready for unlimited AI note-taking? With Zoom Workplace Pro, you'll get unlimited AI note-taking with My Notes, longer meetings up to 30 hours, and more. Don't just take our word for it - See what others are saying about My Notes. Instead of spending time taking detailed notes, I can focus on the conversation and engagement. The AI-generated summaries help ensure important information is captured, decisions are documented, and responsibilities are clearly assigned. Program Director, Education Management. Ready to see all that My Notes can do? Upgrade today <https://click.e.zoom.us/?qs=synthetic-tracking-token>"),
    ("long-en", "en", "coursework", "Course handbook", "This is the course handbook. Review the lecture material and practice exercises. " * 500 + "Final assignment submission is due Friday at noon."),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["minilm", "laya"], required=True)
    parser.add_argument("--precision", choices=["fp32", "int8"], default="int8")
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--template", choices=["original", "concise"], default="original")
    parser.add_argument("--linear-only", action="store_true", help="Leave embedding tables in FP32 when testing INT8")
    parser.add_argument("--skip-long", action="store_true", help="Omit the optional long-email stress case")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    labels = CONCISE_LABELS if args.template == "concise" else LABELS
    os.environ.update(USE_TF="0", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", TOKENIZERS_PARALLELISM="false", CUDA_VISIBLE_DEVICES="")
    import psutil
    import torch
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    from app.email_cleaning import clean_email_body
    process = psutil.Process()
    start = time.perf_counter()
    if args.model == "minilm":
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
        model = AutoModelForSequenceClassification.from_pretrained(MODEL, revision=REVISION, local_files_only=True, use_safetensors=True).eval().cpu()
        parameter_count = sum(p.numel() for p in model.parameters())
        if args.precision == "int8":
            # Quantize the large multilingual embedding table too, not only Linear layers.
            quantization = {torch.nn.Linear: torch.ao.quantization.default_dynamic_qconfig}
            if not args.linear_only:
                quantization[torch.nn.Embedding] = torch.ao.quantization.float_qparams_weight_only_qconfig
            model = torch.ao.quantization.quantize_dynamic(model, quantization, inplace=True)
        def classify(subject, body):
            text = subject + "\n\n" + clean_email_body(body)
            ids = tok(text, add_special_tokens=False)["input_ids"]
            scores, windows = [], 0
            for offset in range(0, len(ids), 300):
                chunk = tok.decode(ids[offset:offset + 384])
                pairs = tok([chunk] * len(labels), list(labels.values()), padding=True, truncation=False, return_tensors="pt")
                # XLM-R's implicit expanded token-type tensor is non-contiguous;
                # the quantized Embedding kernel requires contiguous indices.
                pairs["token_type_ids"] = torch.zeros_like(pairs["input_ids"])
                if pairs["input_ids"].shape[1] > 512:
                    raise ValueError("Window exceeds encoder budget")
                with torch.inference_mode():
                    logits = model(**pairs).logits
                scores.append(logits[:, model.config.label2id["entailment"]].softmax(dim=0))
                windows += 1
                if offset + 384 >= len(ids):
                    break
            # Fixed mean aggregation for topic classification, not calibrated confidence.
            score = torch.stack(scores).mean(dim=0)
            return {"category": list(labels)[score.argmax().item()], "score": score.max().item(), "windows": windows}
    else:
        import app.email_classifier as laya_module
        laya_module.select_device = lambda *args: "cpu"
        classifier = laya_module.EmailClassifier()
        classifier._load()
        parameter_count = None
        def classify(subject, body):
            result = classifier.classify(laya_module.EmailInput(subject, body))
            return {"category": result.category, "score": result.important_probability, "windows": result.windows, "review_reasons": result.review_reasons}
    load_seconds = time.perf_counter() - start
    classify("Coursework", "Submit your mathematics assignment tomorrow.")
    rows = []
    for name, language, expected, subject, body in CASES:
        if args.skip_long and name == "long-en":
            continue
        timings = []
        for _ in range(args.repeat):
            start = time.perf_counter()
            prediction = classify(subject, body)
            timings.append(time.perf_counter() - start)
        # Laya only has four categories: compare mapped categories separately.
        mapped_expected = "other" if expected in {"personal", "promotion"} else expected
        mapped_prediction = "other" if prediction["category"] in {"personal", "promotion"} else prediction["category"]
        rows.append({"id": name, "language": language, "expected": expected, **prediction,
                     "common_category_correct": mapped_expected == mapped_prediction,
                     "median_seconds": statistics.median(timings), "timings": timings})
        print(name, prediction["category"], round(statistics.median(timings), 3), flush=True)
    memory = process.memory_info()
    result = {"model": args.model, "precision": args.precision if args.model == "minilm" else "laya-default", "threads": args.threads,
              "template": args.template, "hypotheses": labels if args.model == "minilm" else None,
              "quantized_embeddings": args.precision == "int8" and not args.linear_only if args.model == "minilm" else False,
              "repeat": args.repeat, "model_revision": REVISION if args.model == "minilm" else laya_module.MODEL_REVISION,
              "torch": torch.__version__, "parameter_count": parameter_count, "load_seconds": load_seconds,
              "rss_mib": memory.rss / 2**20, "peak_rss_mib": getattr(memory, "peak_wset", memory.rss) / 2**20,
              "rows": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print("Saved", args.output, flush=True)


if __name__ == "__main__":
    main()
