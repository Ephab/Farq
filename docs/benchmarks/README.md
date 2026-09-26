# Local email classifier CPU experiment — 2026-09-26

Decision: **do not replace Laya with this MiniLM checkpoint based on this test.**
It is fast on this desktop, but makes basic category mistakes, including the
user's Zoom marketing example. No training was performed and the app default
was not changed.

## Conditions

- Windows, AMD Ryzen 7 7800X3D, approximately 31 GiB installed RAM.
- CPU only, two PyTorch compute threads, one interop thread; GPU hidden.
- This is a modern desktop with constrained threading, not a low-end laptop.
- Separate sequential processes; three measurements per example after warm-up.
- 20 handcrafted short examples: ten English and ten Arabic, with two examples
  per category per language. Plus the user's Zoom marketing content, with a
  synthetic tracking token, and one repetitive long English course handbook.
- No private mailbox was opened or uploaded. All inference ran offline from
  cached model weights. Categories were coursework, administration, opportunity,
  promotion and personal. These fixtures are a smoke test, not a representative
  test set or a statistically meaningful estimate of production accuracy.
- The original hypotheses were tested first. A second, more uniformly worded
  set was tested after failures; those results are diagnostic, not held-out.
- MiniLM: `MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli`, pinned revision
  `0a71e92a985b6e1ad1828cf67ce9c459639c1dca`, 106,995,075 parameters.
- Entire text covered with overlapping 384-token chunks at a 300-token stride.
  Five NLI pairs per chunk; entailment logits normalized across categories and
  averaged across chunks. Scores are not calibrated probabilities.
- INT8 is PyTorch dynamic quantization, not an ONNX deployment benchmark.
  Both Linear-only and Linear-plus-Embedding quantization were tested.
- Runtime uses the existing PyTorch 2.8 CUDA-capable wheel but runs on CPU.
  Process RAM includes Python, libraries and allocator caches, not just weights.
  Loading/quantization time excludes the initial Python/PyTorch import.

## MiniLM findings

Short-email timing is the median of per-example medians across 21 short emails.
Memory is process resident working set after all examples, including the long one.

| Variant | Correct short categories | Median short email | Long email | Resident RAM |
| --- | ---: | ---: | ---: | ---: |
| FP32, original hypotheses | 7/21 | 31.9 ms | 7.99 s | 883 MiB |
| FP32, concise hypotheses | 13/21 | 32.7 ms | 7.92 s | 883 MiB |
| INT8 Linear + Embedding, original | 4/21 | 16.2 ms | 4.47 s | 1,804 MiB |
| INT8 Linear-only, concise | 8/21 | 14.9 ms | 4.33 s | 894 MiB |

The best variant still misses eight short examples. Both FP32 variants label
Zoom's promotion as an opportunity. Linear-only INT8 labels it coursework.
All four variants misclassify the long handbook despite processing all 27 chunks.
Quantization did not reliably preserve category decisions, and quantizing the
embedding table did not reduce this process's measured resident memory.

The two INT8 configurations also use different hypotheses; do not interpret the
difference between those two rows as a controlled embedding-quantization ablation.
Compare each to its matching FP32 row instead.

## Reproduce

Install optional measurement dependencies with `uv sync --extra cpu --group benchmark`
(this selects CPU wheels; the recorded run used the existing CUDA-capable wheel).
The benchmark itself never downloads. First cache the pinned model using
`huggingface_hub.snapshot_download` with the revision above and these files:
`config.json`, `model.safetensors`, `tokenizer.json`, `tokenizer_config.json`,
`special_tokens_map.json`, `sentencepiece.bpe.model`. Cache Laya using `setup.bat`
or `setup.sh` as usual. Weights stay outside Git in the Hugging Face cache.

Run from the repo root, using `.venv/Scripts/python` on Windows:

```sh
python scripts/benchmark_email_models.py --model minilm --precision fp32 --template concise --threads 2 --repeat 3 --output docs/benchmarks/minilm-fp32-concise-cpu.json
python scripts/benchmark_email_models.py --model minilm --precision int8 --linear-only --template concise --threads 2 --repeat 3 --output docs/benchmarks/minilm-int8-linear-concise-cpu.json
python scripts/benchmark_email_models.py --model laya --threads 2 --repeat 3 --output docs/benchmarks/laya-cpu.json
```

For the first two runs, omit `--template concise`; omit `--linear-only` for
embedding quantization. Raw per-message outputs are stored beside this report.
The benchmark script contains all fixture text and hypotheses.

Model documentation: <https://huggingface.co/MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli>.
