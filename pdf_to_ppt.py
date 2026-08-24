"""PDF page rendering and PowerPoint generation for the portfolio tool."""

from __future__ import annotations

import io
from typing import List, Optional, Sequence, Tuple

import pymupdf
from pptx import Presentation
from pptx.util import Inches


PDF_MAX_PAGE_COUNT = 50
MAX_NOTE_LENGTH = 10_000
RENDER_DPI = 120
SLIDE_IMAGE_FORMAT = "jpeg"
SLIDE_IMAGE_QUALITY = 90
MAX_SLIDE_DIMENSION_INCHES = 13.333
EMU_PER_PDF_POINT = 12_700


def _open_pdf(pdf_bytes: bytes):
    if not pdf_bytes:
        raise ValueError("The uploaded PDF was empty.")

    if not pdf_bytes.startswith(b"%PDF-"):
        raise ValueError("Please upload a valid PDF file.")

    try:
        document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise ValueError("The uploaded file could not be read as a PDF.") from exc

    if getattr(document, "needs_pass", False):
        document.close()
        raise ValueError("Password-protected PDFs are not supported yet.")

    if document.page_count < 1:
        document.close()
        raise ValueError("The PDF does not contain any pages.")

    if document.page_count > PDF_MAX_PAGE_COUNT:
        page_count = document.page_count
        document.close()
        raise ValueError(
            f"This PDF has {page_count} pages. Please use a PDF with "
            f"{PDF_MAX_PAGE_COUNT} pages or fewer."
        )

    return document


def get_pdf_page_count(pdf_bytes: bytes) -> int:
    """Validate a PDF and return its page count."""

    document = _open_pdf(pdf_bytes)
    try:
        return document.page_count
    finally:
        document.close()


def _normalise_notes(notes: Optional[Sequence[str]], page_count: int) -> List[str]:
    if notes is None:
        return [""] * page_count

    if not isinstance(notes, (list, tuple)):
        raise ValueError("Presenter comments must be provided as a list.")

    if len(notes) > page_count:
        raise ValueError("Presenter comments cannot contain more entries than PDF pages.")

    normalised: List[str] = []
    for note in notes:
        if not isinstance(note, str):
            raise ValueError("Each presenter comment must be text.")
        cleaned = note.strip()
        if len(cleaned) > MAX_NOTE_LENGTH:
            raise ValueError(
                f"Each presenter comment must be {MAX_NOTE_LENGTH:,} characters or fewer."
            )
        normalised.append(cleaned)

    normalised.extend([""] * (page_count - len(normalised)))
    return normalised


def _slide_size_for_page(page_width: float, page_height: float) -> Tuple[int, int]:
    if page_width <= 0 or page_height <= 0:
        raise ValueError("The PDF contains a page with invalid dimensions.")

    page_width_emu = page_width * EMU_PER_PDF_POINT
    page_height_emu = page_height * EMU_PER_PDF_POINT
    scale = (Inches(MAX_SLIDE_DIMENSION_INCHES) / max(page_width_emu, page_height_emu))
    return int(page_width_emu * scale), int(page_height_emu * scale)


def _fit_image_to_slide(
    page_width: float,
    page_height: float,
    slide_width: int,
    slide_height: int,
) -> Tuple[int, int, int, int]:
    page_ratio = page_width / page_height
    slide_ratio = slide_width / slide_height

    if page_ratio >= slide_ratio:
        image_width = slide_width
        image_height = int(slide_width / page_ratio)
        left = 0
        top = (slide_height - image_height) // 2
    else:
        image_height = slide_height
        image_width = int(slide_height * page_ratio)
        left = (slide_width - image_width) // 2
        top = 0

    return left, top, image_width, image_height


def convert_pdf_to_powerpoint(
    pdf_bytes: bytes,
    notes: Optional[Sequence[str]] = None,
) -> io.BytesIO:
    """Render each PDF page as a slide image and attach presenter notes."""

    document = _open_pdf(pdf_bytes)
    page_count = document.page_count
    page_notes = _normalise_notes(notes, page_count)

    try:
        first_page = document[0]
        slide_width, slide_height = _slide_size_for_page(
            first_page.rect.width,
            first_page.rect.height,
        )

        presentation = Presentation()
        presentation.slide_width = slide_width
        presentation.slide_height = slide_height
        blank_layout = presentation.slide_layouts[6]

        for page_index, page in enumerate(document):
            slide = presentation.slides.add_slide(blank_layout)
            left, top, image_width, image_height = _fit_image_to_slide(
                page.rect.width,
                page.rect.height,
                slide_width,
                slide_height,
            )

            pixmap = page.get_pixmap(dpi=RENDER_DPI, alpha=False)
            image_stream = io.BytesIO(
                pixmap.tobytes(SLIDE_IMAGE_FORMAT, jpg_quality=SLIDE_IMAGE_QUALITY)
            )
            slide.shapes.add_picture(
                image_stream,
                left,
                top,
                width=image_width,
                height=image_height,
            )

            notes_slide = slide.notes_slide
            notes_text_frame = notes_slide.notes_text_frame
            if notes_text_frame is not None:
                notes_text_frame.text = page_notes[page_index]

        output = io.BytesIO()
        presentation.save(output)
        output.seek(0)
        return output
    finally:
        document.close()
