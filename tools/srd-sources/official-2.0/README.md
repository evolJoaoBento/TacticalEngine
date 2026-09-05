# Daggerheart SRD 2.0 — official text

`srd-2.0.txt` is the text of the **official** Daggerheart System Reference Document
2.0 (ver 2026-08-25), downloaded from
<https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf>
and extracted with `extract-pdf-text.mjs`.

This is the version the engine implements. The two community sets alongside it
(`../daggersearch`, `../seansbox`) are still **SRD 1.0** — as of 2026-09-05 neither
upstream repository has updated — so they remain the source for *structured data*
(adversaries, armors, weapons, domain cards) while the rules text comes from here.

## Why an extractor rather than the PDF

The PDF stores its objects in compressed object streams and uses 50 subset fonts,
each with its own encoding. A naive extraction drops every digit and ligature —
"they mark 1 to 3 HP" comes out as "they mark to HP", which is worse than useless
for rules work. `extract-pdf-text.mjs` resolves each page's font resources and
decodes every string through that font's own `/ToUnicode` map.

One trap it works around: the `begincodespacerange` in these fonts declares
`<0000> <FFFF>`, implying two-byte codes, while the actual `beginbfchar` entries
are single bytes. The code width is taken from the entries, not the declaration.

Reproduce with:

```
node extract-pdf-text.mjs <path-to-pdf> srd-2.0-raw.txt
```

The vendored file has had intra-page line breaks flattened so a sentence can be
grepped in one piece; `===== PAGE n =====` markers are kept.

## Attribution

This product includes materials from the Daggerheart System Reference Document
2.0, © Critical Role, LLC. under the terms of the Darrington Press Community
Gaming (DPCGL) License. More information can be found at
<https://www.daggerheart.com>. There are no previous modifications by others.
