# Pylint Journal — ComfyUI-Olm-DragCrop

Code quality learnings specific to this codebase.

---

## 2026-03-07 - Baseline Established
**Learning:** Initial pylint score was 7.14/10. Missing module docstring was an easy high-value fix that required no behavior changes.
**Action:** Added comprehensive module docstring explaining all three nodes and key features. Score improved to 7.17/10 (+0.03).

## 2026-03-07 - Black Formatter Applied
**Learning:** Running black formatter fixed all 6 line-too-long warnings and improved overall code consistency. This was a high-impact, zero-risk change that required no manual intervention.
**Action:** Ran `uv run black *.py` on all Python files. Score improved to 7.28/10 (+0.11, cumulative +0.14 from baseline).

**Next opportunities:**
- Add class docstrings for OlmDragCrop, OlmDragPerspective, OlmCropInfoInterpreter
- Extract helper methods from `crop()` to reduce complexity (53 local variables, 105 statements)

