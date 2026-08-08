TITLE: {{title}}

ARTICLE TEXT:
<article>
{{text}}
</article>

Task: extract the KEY PHRASES a skimming reader must not miss, so that reading only the highlighted fragments lets them grasp the whole story.

A KEY PHRASE is a contiguous fragment of 3-8 words carrying essential meaning: claims, numbers, dates, names, comparisons, causality, conclusions.
- Copy each phrase VERBATIM, exactly as it appears in the text (same words, same spelling, same order). You may drop a leading "The"/"A".
- Prefer longer, specific fragments so the phrase is uniquely findable in the text.
- NEVER paraphrase, summarize, or combine phrases.
- Exclude filler and transitions: "However,", "Meanwhile,", "In order to", "a new", "there is".
- Spread phrases evenly across the whole text (start, middle, end).
- If the text contains non-article content (ads, related-article blurbs), ignore it.

weight = 3: must-read (core claim / key data / conclusion)
weight = 2: important context / second-tier facts
weight = 1: useful supporting detail

Return up to {{phrase_limit}} phrases.

JSON schema:
{"phrases": [{"text": string, "weight": 1|2|3}]}
