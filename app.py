import os
import io
import re
from dataclasses import dataclass
from html import unescape
from typing import List, Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from flask import Flask, Response, render_template, request, send_file
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

ALLOWED_TEMPLATE_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}


@dataclass
class Recipe:
    title: str
    ingredients: List[str]
    steps: List[str]
    notes: List[str]
    source_caption: str

    def to_text(self) -> str:
        parts: List[str] = [self.title.strip() or "Extracted Recipe", ""]

        if self.ingredients:
            parts.append("Ingredients")
            parts.extend([f"- {item}" for item in self.ingredients])
            parts.append("")

        if self.steps:
            parts.append("Instructions")
            parts.extend([f"{i + 1}. {step}" for i, step in enumerate(self.steps)])
            parts.append("")

        if self.notes:
            parts.append("Notes")
            parts.extend([f"- {note}" for note in self.notes])
            parts.append("")

        parts.append("Source Caption")
        parts.append(self.source_caption.strip())
        return "\n".join(parts).strip() + "\n"


def normalize_tiktok_url(raw_url: str) -> str:
    raw_url = (raw_url or "").strip()
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Please provide a full TikTok URL starting with http:// or https://.")
    if "tiktok.com" not in parsed.netloc.lower():
        raise ValueError("Please provide a TikTok URL.")
    return raw_url


def fetch_caption_from_tiktok(video_url: str) -> str:
    errors: List[str] = []

    try:
        oembed_resp = requests.get(
            "https://www.tiktok.com/oembed",
            params={"url": video_url},
            timeout=15,
            headers={"User-Agent": USER_AGENT},
        )
        oembed_resp.raise_for_status()
        oembed = oembed_resp.json()
        title = (oembed.get("title") or "").strip()
        if title:
            return title
        errors.append("oEmbed returned no title.")
    except Exception as exc:
        errors.append(f"oEmbed failed: {exc}")

    try:
        html_resp = requests.get(
            video_url, timeout=15, headers={"User-Agent": USER_AGENT}
        )
        html_resp.raise_for_status()
        soup = BeautifulSoup(html_resp.text, "html.parser")

        for selector in [
            ('meta[property="og:description"]', "content"),
            ('meta[name="description"]', "content"),
            ('meta[property="twitter:description"]', "content"),
        ]:
            tag = soup.select_one(selector[0])
            if tag and tag.get(selector[1]):
                return str(tag.get(selector[1])).strip()

        errors.append("No usable description metadata found in HTML.")
    except Exception as exc:
        errors.append(f"HTML metadata fetch failed: {exc}")

    raise RuntimeError(
        "Could not read recipe caption from TikTok metadata. "
        "Try a public TikTok URL with a visible caption.\n"
        + "\n".join(errors)
    )


def clean_caption(caption: str) -> str:
    cleaned = unescape(caption)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"#([A-Za-z0-9_]+)", r"\1", cleaned)
    cleaned = re.sub(r"@\w+", "", cleaned).strip()
    return cleaned


def split_into_candidate_lines(text: str) -> List[str]:
    raw_parts = re.split(r"(?:\n+|[•\-\u2022]+|\s[|]\s|;)", text)
    parts = [p.strip(" .,:-\t") for p in raw_parts]
    return [p for p in parts if p]


def looks_like_ingredient(line: str) -> bool:
    qty_pattern = r"\b(\d+/\d+|\d+(?:\.\d+)?|one|two|three|half|quarter)\b"
    unit_pattern = (
        r"\b(cup|cups|tbsp|tsp|teaspoon|teaspoons|tablespoon|tablespoons|g|kg|ml|l|oz|"
        r"pound|lb|pinch|clove|cloves|slice|slices|can|cans)\b"
    )
    return bool(re.search(qty_pattern, line.lower())) or bool(re.search(unit_pattern, line.lower()))


def parse_ingredients_section(section_text: str) -> List[str]:
    section_text = section_text.strip(" .")
    if not section_text:
        return []
    parts = re.split(r"(?:\n+|,|•|\u2022|;)", section_text)
    cleaned = [p.strip(" .-") for p in parts if p.strip(" .-")]
    return cleaned


def parse_steps_section(section_text: str) -> List[str]:
    section_text = section_text.strip(" .")
    if not section_text:
        return []

    numbered = re.split(r"(?:^|\s)\d+[).\-]\s*", section_text)
    numbered = [s.strip(" .") for s in numbered if s.strip(" .")]
    if len(numbered) > 1:
        return numbered

    sentence_split = re.split(r"(?:\.\s+|;\s+|\n+|•|\u2022)", section_text)
    return [s.strip(" .") for s in sentence_split if len(s.strip()) > 1]


def extract_recipe(caption: str) -> Recipe:
    cleaned = clean_caption(caption)
    candidates = split_into_candidate_lines(cleaned)

    lower = cleaned.lower()
    title = "Extracted Recipe"
    title_match = re.match(r"^([^.!?]{8,80})", cleaned)
    if title_match:
        title = title_match.group(1).strip().title()

    ingredients: List[str] = []
    steps: List[str] = []
    notes: List[str] = []

    ingredient_mode = "ingredients" in lower
    step_mode = any(token in lower for token in ["instructions", "method", "directions", "steps"])

    ingredient_section_match = re.search(
        r"ingredients?\s*[:\-]\s*(.*?)(?=(?:instructions?|method|directions?|steps?)\s*[:\-]|$)",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if ingredient_section_match:
        ingredients = parse_ingredients_section(ingredient_section_match.group(1))
        ingredient_mode = False

    steps_section_match = re.search(
        r"(?:instructions?|method|directions?|steps?)\s*[:\-]\s*(.*)$",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if steps_section_match:
        steps = parse_steps_section(steps_section_match.group(1))
        step_mode = False

    use_fallback_parsing = not (ingredient_section_match or steps_section_match)

    for idx, line in enumerate(candidates):
        if not use_fallback_parsing:
            break
        line_lower = line.lower()

        if line_lower in {"ingredients", "ingredient"}:
            ingredient_mode = True
            step_mode = False
            continue
        if line_lower in {"instructions", "method", "directions", "steps"}:
            ingredient_mode = False
            step_mode = True
            continue

        if ingredient_mode and not ingredients:
            if looks_like_ingredient(line):
                ingredients.append(line)
                continue
            if any(token in line_lower for token in ["mix", "bake", "cook", "stir", "serve", "boil", "fry"]):
                ingredient_mode = False
                step_mode = True
            else:
                notes.append(line)
                continue

        if step_mode and not steps:
            if re.match(r"^\d+[).\-]\s*", line):
                line = re.sub(r"^\d+[).\-]\s*", "", line).strip()
            steps.append(line)
            continue

        if looks_like_ingredient(line):
            ingredients.append(line)
        elif idx < 2 and len(line.split()) <= 10:
            if title == "Extracted Recipe":
                title = line.title()
            else:
                notes.append(line)
        elif any(token in line_lower for token in ["mix", "bake", "cook", "stir", "serve", "boil", "fry"]):
            steps.append(line)
        else:
            notes.append(line)

    if not steps and notes:
        # If steps were not explicit, preserve useful ordering as simple instructions.
        steps = [n for n in notes if len(n.split()) > 4]
        notes = [n for n in notes if n not in steps]

    ingredients = [
        item
        for item in ingredients
        if "ingredients:" not in item.lower() and "instructions:" not in item.lower()
    ]

    return Recipe(
        title=title,
        ingredients=ingredients,
        steps=steps,
        notes=notes,
        source_caption=cleaned,
    )


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> List[str]:
    wrapped_lines: List[str] = []
    for paragraph in text.splitlines():
        if not paragraph.strip():
            wrapped_lines.append("")
            continue
        words = paragraph.split()
        line = ""
        for word in words:
            candidate = f"{line} {word}".strip()
            bbox = draw.textbbox((0, 0), candidate, font=font)
            if bbox[2] - bbox[0] <= max_width:
                line = candidate
            else:
                if line:
                    wrapped_lines.append(line)
                line = word
        if line:
            wrapped_lines.append(line)
    return wrapped_lines


def _open_template_image() -> Optional[Image.Image]:
    template_upload = request.files.get("template_image")
    if not template_upload or not template_upload.filename:
        return None

    ext = template_upload.filename.rsplit(".", 1)[-1].lower() if "." in template_upload.filename else ""
    if ext not in ALLOWED_TEMPLATE_EXTENSIONS:
        raise ValueError("Template image must be PNG, JPG, JPEG, or WEBP.")

    image_bytes = template_upload.read()
    if not image_bytes:
        raise ValueError("Template image was empty.")

    try:
        template = Image.open(io.BytesIO(image_bytes))
        template.load()
        return template.convert("RGBA")
    except UnidentifiedImageError as exc:
        raise ValueError("Uploaded template is not a valid image.") from exc


def render_recipe_image(recipe_text: str, template_image: Optional[Image.Image] = None) -> io.BytesIO:
    image = template_image.copy() if template_image is not None else Image.new("RGBA", (1080, 1350), color=(249, 245, 236, 255))
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = image.size

    body_font_size = max(22, int(min(width, height) * 0.032))
    try:
        body_font = ImageFont.truetype("arial.ttf", body_font_size)
    except OSError:
        body_font = ImageFont.load_default()

    max_text_width = int(width * 0.75)
    wrapped_lines = _wrap_text(draw, recipe_text.strip(), body_font, max_text_width)
    if not wrapped_lines:
        raise ValueError("No recipe text to render.")

    line_heights: List[int] = []
    max_line_width = 0
    for line in wrapped_lines:
        sample = line or " "
        bbox = draw.textbbox((0, 0), sample, font=body_font)
        line_w = bbox[2] - bbox[0]
        line_h = bbox[3] - bbox[1]
        max_line_width = max(max_line_width, line_w)
        line_heights.append(line_h + (8 if line else 16))

    max_text_height = int(height * 0.8)
    while sum(line_heights) > max_text_height and len(wrapped_lines) > 1:
        wrapped_lines.pop()
        line_heights.pop()
    if sum(line_heights) > max_text_height and wrapped_lines:
        wrapped_lines = [wrapped_lines[0][:200] + "..."]
        bbox = draw.textbbox((0, 0), wrapped_lines[0], font=body_font)
        max_line_width = bbox[2] - bbox[0]
        line_heights = [bbox[3] - bbox[1]]

    total_text_height = sum(line_heights)
    y = (height - total_text_height) // 2

    padding_x = max(24, int(width * 0.03))
    padding_y = max(20, int(height * 0.02))
    box_left = (width - max_line_width) // 2 - padding_x
    box_right = (width + max_line_width) // 2 + padding_x
    box_top = y - padding_y
    box_bottom = y + total_text_height + padding_y
    draw.rounded_rectangle(
        [(box_left, box_top), (box_right, box_bottom)],
        radius=max(18, int(width * 0.02)),
        fill=(255, 255, 255, 208),
        outline=(60, 60, 60, 60),
        width=2,
    )

    for idx, line in enumerate(wrapped_lines):
        if not line:
            y += line_heights[idx]
            continue
        bbox = draw.textbbox((0, 0), line, font=body_font)
        line_width = bbox[2] - bbox[0]
        x = (width - line_width) // 2
        draw.text((x, y), line, fill=(30, 30, 30, 255), font=body_font)
        y += line_heights[idx]

    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


@app.route("/", methods=["GET"])
def index() -> str:
    return render_template("index.html")


@app.route("/extract", methods=["POST"])
def extract() -> str:
    video_url = normalize_tiktok_url(request.form.get("video_url", ""))
    caption = fetch_caption_from_tiktok(video_url)
    recipe = extract_recipe(caption)
    recipe_text = recipe.to_text()

    return render_template(
        "index.html",
        video_url=video_url,
        caption=caption,
        recipe_text=recipe_text,
    )


@app.route("/download/txt", methods=["POST"])
def download_txt() -> Response:
    recipe_text = request.form.get("recipe_text", "").strip()
    if not recipe_text:
        raise ValueError("No recipe text to download.")
    return Response(
        recipe_text,
        mimetype="text/plain",
        headers={"Content-Disposition": 'attachment; filename="recipe.txt"'},
    )


@app.route("/download/image", methods=["POST"])
def download_image():
    recipe_text = request.form.get("recipe_text", "").strip()
    if not recipe_text:
        raise ValueError("No recipe text to render.")
    template_image = _open_template_image()
    image_bytes = render_recipe_image(recipe_text, template_image=template_image)
    return send_file(
        image_bytes,
        mimetype="image/png",
        as_attachment=True,
        download_name="recipe-card.png",
    )


@app.errorhandler(Exception)
def handle_exception(error: Exception):
    return (
        render_template("index.html", error_message=str(error)),
        400,
    )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)
