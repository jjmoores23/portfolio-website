# Jacob Moores Portfolio

This repository contains a static portfolio website and a Flask-backed TikTok
recipe extractor. Recipe text can also be pasted and parsed entirely in the
browser when TikTok metadata is unavailable.

## Local setup

Python 3.9–3.13 is recommended. From the repository root:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
```

Start the API in one terminal:

```sh
source .venv/bin/activate
flask --app app run --port 5000
```

Start the static portfolio in another terminal:

```sh
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/tiktok-extractor.html`.

## How extraction works

The portfolio sends TikTok URLs to `POST /api/extract`. Flask validates the
hostname and requests TikTok's oEmbed metadata, falling back to HTML metadata.
It returns the caption, thumbnail URL, structured recipe, and formatted text as
JSON. Browser-side parsing remains available for manually pasted captions.

Image-card downloads use the extracted recipe title as the filename and default
to the bundled pastel border when no custom template is selected. Image cards
contain the formatted recipe but intentionally omit the original source caption.
On browsers that support sharing files, the Share / Save to Photos button opens
the device share sheet with the generated PNG. On iPhone, choose Save Image in
that sheet; browsers without file sharing fall back to a normal download.

The API cannot retrieve private, deleted, region-restricted, or otherwise
blocked TikTok videos. In those cases, paste the caption or transcript manually.

## Tests

```sh
source .venv/bin/activate
pytest -q
```

With both local servers running, exercise the real Chrome interface against the
known public TikTok fixture:

```sh
RUN_E2E=1 pytest tests/test_browser.py -q
```

## Deployment

`render.yaml` defines the Flask service. The static portfolio currently calls
`https://tiktok-recipe-extractor.onrender.com` outside local development; update
`HOSTED_EXTRACTOR_URL` in `tiktok-extractor.js` if the Render service URL changes.
The backend must be redeployed after adding or changing API routes; the legacy
HTML `/extract` route cannot be consumed as JSON by the portfolio page.
