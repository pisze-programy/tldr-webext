TITLE: {{title}}
BYLINE: {{byline}}
PUBLISHED: {{published}}

ARTICLE TEXT:
<article>
{{text}}
</article>

Task: write a reader's summary shown ABOVE the untouched article. It must be easy to scan from top to bottom.

Rules:
- "tldr": one sentence, max 25 words — what the article is about + the single most important takeaway.
- "keywords": up to 8 distinct technical terms, names, or numbers taken verbatim from the article.
- "sections": 2-4 sections. Each has a short "heading" (max 5 words) and 2-4 "points".
- Each point has:
  - "text": max ~18 words; includes the key technical terms.
  - "anchor": the exact VERBATIM sentence from the article that supports this point.
    Copy it character-for-character (same words, same spelling, same order). Prefer a unique, self-contained sentence.
    If no good anchor exists for a point, set "anchor" to "".
- Keep every number exact.
- No emoji.
- If the text contains non-article content (ads, related-article blurbs, newsletter pitches), ignore it.

JSON schema:
{"tldr": string, "keywords": [string], "sections": [{"heading": string, "points": [{"text": string, "anchor": string}]}]}
