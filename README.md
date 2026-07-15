# TikTok Recipe Extractor (Simple Flask App)

This app takes a TikTok URL, attempts to read caption metadata, and returns only a cleaned recipe name, ingredients, and instructions.

## Features
- Paste TikTok video URL
- Fetch caption from TikTok metadata (`oEmbed` first, HTML meta fallback)
- Heuristic recipe extraction (recipe name + ingredients + instructions only)
- Download output as:
  - `recipe.txt`
  - `recipe-card.png`
- Optional custom template upload (`.png`, `.jpg`, `.jpeg`, `.webp`) for image download.
  If none is uploaded, the included pastel template is used by default.
- Title is rendered larger near the top of the safe zone, with ingredients/instructions in the middle.
- If TikTok metadata provides a thumbnail, it is added at the bottom of the safe zone when rendering the card.

## Run locally
```powershell
python -m pip install -r requirements.txt
python app.py
```

Then open:
`http://127.0.0.1:5000`

## Notes
- Some TikTok links may block metadata scraping due to anti-bot or region/privacy restrictions.
- For best results, use public videos with caption text that includes ingredients or steps.
