TITLE: {{title}}

ARTICLE TEXT:
<article>
{{text}}
</article>

Task: extract the KEY PHRASES a skimming reader must not miss, so that a reader who scans ONLY the highlighted fragments understands the whole story.

A KEY PHRASE is a contiguous fragment of 3-12 words carrying essential meaning: claims, numbers, dates, names, comparisons, causality, conclusions.
- Copy each phrase VERBATIM, exactly as it appears in the text (same words, same spelling, same order). You may drop a leading "The"/"A".
- Prefer longer, specific fragments so the phrase is uniquely findable in the text.
- NEVER paraphrase, summarize, or combine phrases.
- Strictly 3-12 words, never longer.
- Exclude filler and transitions: "However,", "Meanwhile,", "In order to", "a new", "there is".
- COVERAGE: represent every paragraph and section. Do not skip whole sections or leave the second half of the article unhighlighted. Aim for about one phrase per 1-2 sentences.
- PREFER the exact formula, equation, or number itself over the sentence that describes it (e.g. highlight "255 - INPUT", not the paragraph about it).
- Do not extract the page title, the publication date, the byline, or image captions.
- If the text contains non-article content (ads, related-article blurbs), ignore it.

weight = 1..6 scale:
6 = single most important claim (max 2 total)
5 = major fact or argument (max 5 total)
4 = important context
3 = supporting context
2 = useful detail
1 = minor detail (use sparingly)
Distribute across the full range. Avoid clustering weights at 5-6.

Return phrases ORDERED BY THEIR POSITION IN THE ARTICLE (the phrase that appears first in the article must appear first in the JSON array). This ordering is mandatory.

Return {{phrase_limit}} phrases.

JSON schema:
{"phrases": [{"text": string, "weight": 1|2|3|4|5|6}]}
