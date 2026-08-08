TITLE: {{title}}
BYLINE: {{byline}}
PUBLISHED: {{published}}

ARTICLE TEXT:
<article>
{{text}}
</article>

Task: write a reader's summary to be shown ABOVE the untouched article.
- "tldr": one sentence, max 25 words — what the article is about + the single most important takeaway.
- "bullets": 3-5 short bullets (max 15 words each) covering: what happened, key data, who is affected, conclusion/implication.
- Keep every number exact.
- If the text contains non-article content (ads, related-article blurbs, newsletter pitches), ignore it.

JSON schema:
{"tldr": string, "bullets": [string]}
