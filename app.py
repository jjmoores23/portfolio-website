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
from flask import Flask, Response, jsonify, render_template, request, send_file
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
CORS(app, resources={r"/api/*": {"origins": "*"}})

ALLOWED_TEMPLATE_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
DEFAULT_TEMPLATE_PATH = Path(__file__).with_name("Cute Pastel Border Design.jpeg")
RECIPE_CARD_LOGO_PATH = Path(__file__).with_name("newlogo.png")


def _load_default_template() -> Image.Image:
    with Image.open(DEFAULT_TEMPLATE_PATH) as default_template:
        default_template.load()
        return default_template.convert("RGBA")


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
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if hostname != "tiktok.com" and not hostname.endswith(".tiktok.com"):
        raise ValueError("Please provide a TikTok URL.")
    return raw_url


def fetch_metadata_from_tiktok(video_url: str) -> dict:
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
            return {
                "caption": title,
                "thumbnail_url": (oembed.get("thumbnail_url") or "").strip(),
            }
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
                thumbnail = soup.select_one('meta[property="og:image"]')
                return {
                    "caption": str(tag.get(selector[1])).strip(),
                    "thumbnail_url": (
                        str(thumbnail.get("content")).strip()
                        if thumbnail and thumbnail.get("content")
                        else ""
                    ),
                }

        errors.append("No usable description metadata found in HTML.")
    except Exception as exc:
        errors.append(f"HTML metadata fetch failed: {exc}")

    raise RuntimeError(
        "Could not read recipe caption from TikTok metadata. "
        "Try a public TikTok URL with a visible caption.\n"
        + "\n".join(errors)
    )


def fetch_caption_from_tiktok(video_url: str) -> str:
    return str(fetch_metadata_from_tiktok(video_url)["caption"])


def clean_caption(caption: str) -> str:
    cleaned = unescape(caption)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"(?:\s*#[A-Za-z0-9_]+)+\s*$", "", cleaned).strip()
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
    section_text = re.sub(
        r"(?i)(\bpotatoes?)\s+(?=(?:olive|vegetable|canola)\s+oil\b)",
        r"\1\n",
        section_text,
    )
    section_text = re.sub(
        r"(?<!\d)\s+(?=(?:\d+(?:\s+\d+/\d+|/\d+|-\d+)?)\s+(?i:lb|lbs|tsp|tbsp|oz|cups?|chopped)\b)",
        "\n",
        section_text,
    )
    parts = re.split(
        r"(?:\n+|\s{2,}|\s+[-•\u2022]\s+|;|,\s+(?=(?i:\d|one\b|two\b|three\b|half\b|quarter\b)))",
        section_text,
    )
    cleaned = [p.strip(" .-") for p in parts if p.strip(" .-")]
    return cleaned


def parse_steps_section(section_text: str) -> List[str]:
    section_text = section_text.strip(" .")
    if not section_text:
        return []
    section_text = re.sub(r"(?:\s*#[A-Za-z0-9_]+)+\s*$", "", section_text).strip(" .")

    spaced = re.split(r"\s{2,}", section_text)
    spaced = [s.strip(" .") for s in spaced if s.strip(" .")]
    if len(spaced) > 1:
        return spaced

    dashed = re.split(r"\s+[-•\u2022]\s+", section_text)
    dashed = [
        s.strip(" .")
        for s in dashed
        if s.strip(" .") and re.search(r"\w", s, flags=re.UNICODE)
    ]
    if len(dashed) > 1:
        return dashed

    numbered = re.split(r"(?:^|\s)\d+[).]\s*", section_text)
    numbered = [s.strip(" .") for s in numbered if s.strip(" .")]
    if len(numbered) > 1:
        return numbered

    sentence_split = re.split(r"(?:\.\s+|;\s+|\n+|•|\u2022)", section_text)
    return [s.strip(" .") for s in sentence_split if len(s.strip()) > 1]


def extract_recipe(caption: str) -> Recipe:
    raw_caption = unescape(caption or "").strip()
    cleaned = clean_caption(caption)
    candidates = split_into_candidate_lines(cleaned)

    lower = cleaned.lower()
    title = "Extracted Recipe"
    title_from_sections = re.split(
        r"\b(?:ingredients?|instructions?|method|directions?|steps?)\b",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip(" :-")
    raw_title_prefix = re.split(
        r"\b(?:ingredients?|instructions?|method|directions?|steps?)\b",
        raw_caption,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip()
    explicit_heading_title = ""
    if raw_title_prefix.endswith(":"):
        explicit_heading_title = raw_title_prefix[:-1].strip()
        explicit_heading_title = re.split(
            r"[\u2600-\u27BF\U0001F300-\U0001FAFF]",
            explicit_heading_title,
        )[-1].strip()
        explicit_heading_title = re.split(r"[.!?]", explicit_heading_title)[-1].strip()
        if not 2 <= len(explicit_heading_title.split()) <= 14:
            explicit_heading_title = ""
    title_before_emoji = re.split(
        r"[\u2600-\u27BF\U0001F300-\U0001FAFF]",
        title_from_sections,
        maxsplit=1,
    )[0].strip()
    promotional_title = re.search(
        r"\bthis\s+(.{3,80}?)\s+(?:won['’]?t\s+disappoint|will\s+not\s+disappoint)\b",
        title_from_sections,
        flags=re.IGNORECASE,
    )
    if explicit_heading_title:
        title = explicit_heading_title
    elif promotional_title:
        title = promotional_title.group(1).strip(" .,!?:-")
    elif 2 <= len(title_before_emoji.split()) <= 14:
        title = title_before_emoji
    elif 2 <= len(title_from_sections.split()) <= 14:
        title = title_from_sections
    else:
        title_match = re.match(r"^([^.!?]{8,80})", cleaned)
        if title_match:
            title = title_match.group(1).strip().title()

    ingredients: List[str] = []
    steps: List[str] = []
    notes: List[str] = []

    ingredient_mode = "ingredients" in lower
    step_mode = any(token in lower for token in ["instructions", "method", "directions", "steps"])

    ingredient_section_match = re.search(
        r"ingredients?\s*[:\-]?\s*(.*?)(?=(?:instructions?|method|directions?|steps?)\s*[:\-]?\s|$)",
        raw_caption,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if ingredient_section_match:
        ingredients = parse_ingredients_section(ingredient_section_match.group(1))
        ingredient_mode = False

    steps_section_match = re.search(
        r"(?:instructions?|method|directions?|steps?)\s*[:\-]?\s*(.*)$",
        raw_caption,
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
        return _load_default_template()

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


def _image_only_recipe_text(recipe_text: str) -> str:
    return re.split(r"\nSource Caption\s*\n", recipe_text, maxsplit=1, flags=re.IGNORECASE)[0].strip()


def _safe_recipe_filename(title: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", title or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(". ")
    return cleaned if cleaned and cleaned.lower() != "extracted recipe" else "TikTokRecipe"


def _load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _extend_template(template: Image.Image, target_height: int) -> Image.Image:
    width, source_height = template.size
    if target_height <= source_height:
        return template.copy()

    top_slice = int(source_height * 0.24)
    bottom_slice = int(source_height * 0.22)
    middle = template.crop((0, top_slice, width, source_height - bottom_slice))
    middle = middle.resize(
        (width, target_height - top_slice - bottom_slice),
        Image.Resampling.LANCZOS,
    )
    result = Image.new("RGBA", (width, target_height))
    result.paste(template.crop((0, 0, width, top_slice)), (0, 0))
    result.paste(middle, (0, top_slice))
    result.paste(
        template.crop((0, source_height - bottom_slice, width, source_height)),
        (0, target_height - bottom_slice),
    )
    return result


def _add_recipe_card_logo(image: Image.Image, size: int, bottom_offset: int) -> None:
    with Image.open(RECIPE_CARD_LOGO_PATH) as logo_source:
        logo = logo_source.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    x = (image.width - size) // 2
    y = image.height - bottom_offset - size
    image.paste(logo, (x, y), mask)


def render_recipe_image(recipe_text: str, template_image: Optional[Image.Image] = None) -> io.BytesIO:
    template = template_image.copy() if template_image is not None else _load_default_template()
    if template is None:
        raise ValueError("The default recipe card template could not be loaded.")

    image_text = _image_only_recipe_text(recipe_text)
    if not image_text:
        raise ValueError("No recipe text to render.")

    title, *body_parts = image_text.splitlines()
    title = title.strip() or "TikTokRecipe"
    body_text = "\n".join(body_parts).strip()
    width = template.width
    safe_left = int(width * 0.17)
    safe_width = int(width * 0.66)
    title_font_size = max(30, int(width * 0.046))
    body_font_size = max(20, int(width * 0.03))
    title_font = _load_font(title_font_size, bold=True)
    body_font = _load_font(body_font_size)

    measuring_draw = ImageDraw.Draw(template)
    title_lines = _wrap_text(measuring_draw, title, title_font, safe_width)
    body_lines = _wrap_text(measuring_draw, body_text, body_font, safe_width)
    title_line_height = int(title_font_size * 1.25)
    body_line_height = int(body_font_size * 1.38)
    safe_top = 165
    content_gap = int(body_line_height * 0.7)
    logo_size = max(62, int(width * 0.095))
    logo_bottom_offset = max(110, int(width * 0.15))
    safe_bottom_padding = logo_size + logo_bottom_offset + max(36, int(width * 0.05))
    required_height = (
        safe_top
        + len(title_lines) * title_line_height
        + content_gap
        + len(body_lines) * body_line_height
        + safe_bottom_padding
    )

    image = _extend_template(template, max(template.height, required_height))
    draw = ImageDraw.Draw(image, "RGBA")
    y = safe_top
    text_color = (69, 42, 49, 245)

    for line in title_lines:
        bbox = draw.textbbox((0, 0), line, font=title_font)
        x = (width - (bbox[2] - bbox[0])) // 2
        draw.text((x, y), line, fill=text_color, font=title_font)
        y += title_line_height

    y += content_gap
    for line in body_lines:
        if line:
            draw.text((safe_left, y), line, fill=text_color, font=body_font)
        y += body_line_height

    _add_recipe_card_logo(image, logo_size, logo_bottom_offset)

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


@app.route("/api/extract", methods=["POST"])
def api_extract():
    payload = request.get_json(silent=True) or request.form
    video_url = normalize_tiktok_url(payload.get("video_url", ""))
    metadata = fetch_metadata_from_tiktok(video_url)
    caption = str(metadata["caption"])
    recipe = extract_recipe(caption)

    return jsonify(
        {
            "video_url": video_url,
            "caption": caption,
            "thumbnail_url": metadata.get("thumbnail_url", ""),
            "recipe": {
                "title": recipe.title,
                "ingredients": recipe.ingredients,
                "steps": recipe.steps,
                "notes": recipe.notes,
                "source_caption": recipe.source_caption,
            },
            "recipe_text": recipe.to_text(),
        }
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
        download_name=f"{_safe_recipe_filename(_image_only_recipe_text(recipe_text).splitlines()[0])}.png",
    )


@app.errorhandler(Exception)
def handle_exception(error: Exception):
    if request.path.startswith("/api/"):
        return jsonify({"error": str(error)}), 400
    return (
        render_template("index.html", error_message=str(error)),
        400,
    )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)
