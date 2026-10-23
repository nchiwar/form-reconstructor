import os
import pymupdf as fitz
from app.services.signature import extract_transparent_signature

INK_COLORS = {
    "navy": (0.05, 0.10, 0.45),
    "black": (0.08, 0.08, 0.08),
    "blue": (0.0, 0.25, 0.75),
}

FONT_FAMILIES = {
    "helv": "helv",   # Crisp Sans-Serif (Helvetica)
    "tiro": "tiro",   # Formal Serif (Times-Roman)
    "cour": "cour",   # Typewriter Monospace (Courier)
}


def stamp_clean_pdf(
    blank_pdf_path: str,
    fields: list[dict],
    output_pdf_path: str,
    upload_dir: str,
    session_id: str,
    ink_color: str = "navy",
    font_family: str = "helv",
) -> str:
    """
    Stamps verified text, checkboxes, and transparent real-ink signatures
    across any number of pages (1 to 50+ pages) on the original blank PDF.
    """
    doc = fitz.open(blank_pdf_path)
    chosen_color = INK_COLORS.get(ink_color, INK_COLORS["navy"])
    chosen_font = FONT_FAMILIES.get(font_family, "helv")

    for idx, item in enumerate(fields):
        page_num = int(item.get("page_num", 0))
        if page_num >= doc.page_count:
            continue

        page = doc.load_page(page_num)
        pdf_width = page.rect.width
        pdf_height = page.rect.height

        field_type = item.get("field_type", "text")
        value = str(item.get("handwritten_value", "")).strip()
        if not value:
            continue

        ymin, xmin, ymax, xmax = item.get("box_2d", [0, 0, 0, 0])

        offset_x = float(item.get("offset_x", 0))
        offset_y = float(item.get("offset_y", 0))
        custom_font_size = float(item.get("font_size", 0))

        xmin += offset_x
        xmax += offset_x
        ymin += offset_y
        ymax += offset_y

        x0 = (xmin / 1000.0) * pdf_width
        y0 = (ymin / 1000.0) * pdf_height
        x1 = (xmax / 1000.0) * pdf_width
        y1 = (ymax / 1000.0) * pdf_height

        # 1. Real Ink Signature / Stamp Lifting
        if field_type == "signature":
            aligned_scan_path = os.path.join(
                upload_dir, f"{session_id}_page_{page_num}_aligned.jpg"
            )
            sig_png_path = os.path.join(upload_dir, f"{session_id}_sig_{idx}.png")
            if os.path.exists(aligned_scan_path):
                try:
                    extract_transparent_signature(
                        aligned_scan_path,
                        [int(ymin), int(xmin), int(ymax), int(xmax)],
                        sig_png_path,
                    )
                    sig_rect = fitz.Rect(x0, y0, x1, y1)
                    page.insert_image(
                        sig_rect, filename=sig_png_path, keep_proportion=True
                    )
                    continue
                except Exception:
                    pass

        # 2. Clean Digital Text & Checkmarks
        box_height = max(y1 - y0, 10)
        font_size = (
            custom_font_size
            if custom_font_size > 0
            else min(max(box_height * 0.65, 9), 14)
        )
        baseline_y = y1 - (box_height * 0.18)

        page.insert_text(
            fitz.Point(x0 + 2, baseline_y),
            value,
            fontsize=font_size,
            fontname=chosen_font,
            color=chosen_color,
        )

    doc.save(output_pdf_path, garbage=4, deflate=True)
    doc.close()
    return output_pdf_path