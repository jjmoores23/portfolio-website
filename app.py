import os
import io
import re
from dataclasses import dataclass
from html import unescape
from pathlib import Path
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
DEFAULT_TEMPLATE_PATH = Path(__file__).resolve().parent / "static" / "default-template.png"


@dataclass
class TikTokMetadata:
    caption: str
    thumbnail_url: Optional[str]


@dataclass
class Recipe:
    title: str
    ingredients: List[str]
    steps: List[str]

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

        return "\n".join(parts).strip() + "\n"


def normalize_tiktok_url(raw_url: str) -> str:
    raw_url = (raw_url or "").strip()
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Please provide a full TikTok URL starting with http:// or https://.")
    if "tiktok.com" not in parsed.netloc.lower():
        raise ValueError("Please provide a TikTok URL.")
    return raw_url


def fetch_tiktok_metadata(video_url: str) -> TikTokMetadata:
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
        thumbnail_url = (oembed.get("thumbnail_url") or "").strip() or None
        if title:
            return TikTokMetadata(caption=title, thumbnail_url=thumbnail_url)
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
                thumb_tag = soup.select_one('meta[property="og:image"]')
                thumbnail_url = (
                    str(thumb_tag.get("content")).strip()
                    if thumb_tag and thumb_tag.get("content")
                    else None
                )
                return TikTokMetadata(
                    caption=str(tag.get(selector[1])).strip(),
                    thumbnail_url=thumbnail_url,
                )

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
    title_from_sections = re.split(
        r"\bingredients?\b|\binstructions?\b|\bmethod\b|\bdirections?\b|\bsteps?\b",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip(" :-")
    if title_from_sections and 2 <= len(title_from_sections.split()) <= 14:
        title = title_from_sections.title()
    else:
        title_match = re.match(r"^([^.!?]{8,80})", cleaned)
        if title_match:
            title = title_match.group(1).strip().title()

    ingredients: List[str] = []
    steps: List[str] = []

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
        elif any(token in line_lower for token in ["mix", "bake", "cook", "stir", "serve", "boil", "fry"]):
            steps.append(line)

    ingredients = [
        item
        for item in ingredients
        if "ingredients:" not in item.lower() and "instructions:" not in item.lower()
    ]

    return Recipe(
        title=title,
        ingredients=ingredients,
        steps=steps,
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
        if DEFAULT_TEMPLATE_PATH.exists():
            return Image.open(DEFAULT_TEMPLATE_PATH).convert("RGBA")
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


def _fetch_thumbnail_image(thumbnail_url: Optional[str]) -> Optional[Image.Image]:
    if not thumbnail_url:
        return None
    parsed = urlparse(thumbnail_url)
    if parsed.scheme not in {"http", "https"}:
        return None
    resp = requests.get(thumbnail_url, timeout=15, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    image = Image.open(io.BytesIO(resp.content))
    image.load()
    return image.convert("RGBA")


def _split_recipe_text(recipe_text: str) -> tuple[str, str]:
    lines = [line.rstrip() for line in recipe_text.splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    title = lines[0].strip() if lines else "Extracted Recipe"
    body_lines = lines[1:] if len(lines) > 1 else []
    body = "\n".join(body_lines).strip()
    return title, body


def _fit_font(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    max_height: int,
    start_size: int,
    min_size: int,
) -> tuple[ImageFont.ImageFont, List[str], int]:
    for size in range(start_size, min_size - 1, -2):
        try:
            font = ImageFont.truetype("arial.ttf", size)
        except OSError:
            font = ImageFont.load_default()
        lines = _wrap_text(draw, text, font, max_width)
        line_heights: List[int] = []
        for line in lines:
            sample = line or " "
            bbox = draw.textbbox((0, 0), sample, font=font)
            line_heights.append((bbox[3] - bbox[1]) + (8 if line else 14))
        if sum(line_heights) <= max_height:
            return font, lines, sum(line_heights)
    font = ImageFont.load_default()
    lines = _wrap_text(draw, text, font, max_width)
    line_heights = []
    for line in lines:
        sample = line or " "
        bbox = draw.textbbox((0, 0), sample, font=font)
        line_heights.append((bbox[3] - bbox[1]) + (8 if line else 14))
    return font, lines, sum(line_heights)


def render_recipe_image(
    recipe_text: str,
    template_image: Optional[Image.Image] = None,
    thumbnail_url: Optional[str] = None,
) -> io.BytesIO:
    image = template_image.copy() if template_image is not None else Image.new("RGBA", (1080, 1350), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = image.size

    safe_left = int(width * 0.15)
    safe_top = int(height * 0.11)
    safe_right = int(width * 0.85)
    safe_bottom = int(height * 0.92)
    safe_width = safe_right - safe_left
    safe_height = safe_bottom - safe_top

    title, body = _split_recipe_text(recipe_text.strip())
    if not title and not body:
        raise ValueError("No recipe text to render.")

    thumbnail_image = None
    if thumbnail_url:
        try:
            thumbnail_image = _fetch_thumbnail_image(thumbnail_url)
        except (requests.RequestException, UnidentifiedImageError, OSError, ValueError) as exc:
            app.logger.warning("Skipping TikTok thumbnail due to fetch/render error: %s", exc)
            thumbnail_image = None

    thumbnail_reserved_height = int(safe_height * 0.24) if thumbnail_image else 0
    title_area_height = int(safe_height * 0.2)
    body_area_top = safe_top + title_area_height
    body_area_bottom = safe_bottom - thumbnail_reserved_height
    body_area_height = max(50, body_area_bottom - body_area_top)

    title_font, wrapped_title_lines, title_height = _fit_font(
        draw=draw,
        text=title,
        max_width=int(safe_width * 0.96),
        max_height=title_area_height,
        start_size=max(36, int(min(width, height) * 0.065)),
        min_size=22,
    )

    body_font, wrapped_body_lines, _ = _fit_font(
        draw=draw,
        text=body,
        max_width=int(safe_width * 0.98),
        max_height=body_area_height,
        start_size=max(24, int(min(width, height) * 0.04)),
        min_size=16,
    )

    title_y = safe_top + max(6, int((title_area_height - title_height) * 0.5))
    for line in wrapped_title_lines:
        sample = line or " "
        bbox = draw.textbbox((0, 0), sample, font=title_font)
        line_width = bbox[2] - bbox[0]
        line_height = bbox[3] - bbox[1]
        draw.text((safe_left + (safe_width - line_width) // 2, title_y), line, fill=(45, 28, 35, 255), font=title_font)
        title_y += line_height + (8 if line else 14)

    body_total_height = 0
    body_line_heights: List[int] = []
    for line in wrapped_body_lines:
        sample = line or " "
        bbox = draw.textbbox((0, 0), sample, font=body_font)
        lh = (bbox[3] - bbox[1]) + (6 if line else 12)
        body_line_heights.append(lh)
        body_total_height += lh
    body_y = body_area_top + max(0, (body_area_height - body_total_height) // 2)

    for idx, line in enumerate(wrapped_body_lines):
        if not line:
            body_y += body_line_heights[idx]
            continue
        bbox = draw.textbbox((0, 0), line or " ", font=body_font)
        line_width = bbox[2] - bbox[0]
        x = safe_left + (safe_width - line_width) // 2
        draw.text((x, body_y), line, fill=(45, 28, 35, 255), font=body_font)
        body_y += body_line_heights[idx]

    if thumbnail_image:
        thumb_max_w = int(safe_width * 0.72)
        thumb_max_h = int(safe_height * 0.21)
        thumb = thumbnail_image.copy()
        thumb.thumbnail((thumb_max_w, thumb_max_h), Image.Resampling.LANCZOS)
        thumb_x = safe_left + (safe_width - thumb.width) // 2
        thumb_y = safe_bottom - thumb.height
        image.alpha_composite(thumb, dest=(thumb_x, thumb_y))

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


@app.route("/", methods=["GET"])
def index() -> str:
    return render_template("index.html")


@app.route("/extract", methods=["POST"])
def extract() -> str:
    video_url = normalize_tiktok_url(request.form.get("video_url", ""))
    metadata = fetch_tiktok_metadata(video_url)
    recipe = extract_recipe(metadata.caption)
    recipe_text = recipe.to_text()

    return render_template(
        "index.html",
        video_url=video_url,
        recipe_text=recipe_text,
        thumbnail_url=metadata.thumbnail_url or "",
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
    thumbnail_url = request.form.get("thumbnail_url", "").strip() or None
    template_image = _open_template_image()
    image_bytes = render_recipe_image(
        recipe_text,
        template_image=template_image,
        thumbnail_url=thumbnail_url,
    )
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
