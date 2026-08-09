TITLE: {{title}}
BYLINE: {{byline}}
PUBLISHED: {{published}}

ARTICLE TEXT:
<article>
{{text}}
</article>

{{chunk_note}}

Task: compress the article into a digest readable in ~60 seconds.
Target total length: {{target_words}} words. Stay close to it.

Structure:
- "tldr": one sentence, max 20 words.
- 3-6 "sections": each a short heading (max 6 words) + 3-6 bullet points.
- Each bullet is a complete, standalone short sentence (max ~15 words): subject + essential fact.
- Preserve the cause -> effect structure and every key number, name, date, and direct quote.
- Cover the whole arc: context -> key developments -> data -> opposing view (if any) -> outcome -> takeaway.
- Skip: marketing, filler, boilerplate bio, related-article blurbs, newsletter pitches.
- If the text contains non-article content (ads, related-article blurbs), ignore it.

JSON schema:
{"tldr": string, "sections": [{"heading": string, "points": [string]}]}
