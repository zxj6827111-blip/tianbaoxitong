# Archive Parse Fixtures

This directory stores regression fixtures for archive parsing.

Subfolders:

- `normal/`: expected well-formed samples.
- `abnormal/`: malformed or partially broken samples.
- `unit_scale/`: samples that exercise unit normalization logic.
- `ocr_noise/`: noisy OCR-like samples.
- `golden/`: benchmark samples with manually labeled expected output.

Recommended naming in `golden/`:

- `sample_001.txt` or `sample_001.pdf`
- `sample_001.expected.json`
