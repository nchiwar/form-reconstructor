import cv2
import numpy as np
import pymupdf as fitz


def get_pdf_page_count(pdf_path: str) -> int:
    doc = fitz.open(pdf_path)
    count = doc.page_count
    doc.close()
    return count


def pdf_page_to_image(pdf_path: str, page_num: int = 0, dpi: int = 300) -> np.ndarray:
    """Renders a specific PDF page into an OpenCV BGR image array."""
    doc = fitz.open(pdf_path)
    page = doc.load_page(page_num)
    pix = page.get_pixmap(dpi=dpi)

    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n).copy()
    if pix.n == 4:
        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
    elif pix.n == 3:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

    doc.close()
    return img


def stamp_fiducial_markers(blank_pdf_path: str, output_pdf_path: str) -> str:
    """
    Stamps high-contrast precision corner alignment targets (fiducial markers)
    and a corner registration tag onto every page of a blank PDF before printing.
    """
    doc = fitz.open(blank_pdf_path)
    for page in doc:
        w, h = page.rect.width, page.rect.height
        margin = 18
        size = 12

        corners = [
            fitz.Rect(margin, margin, margin + size, margin + size),
            fitz.Rect(w - margin - size, margin, w - margin, margin + size),
            fitz.Rect(margin, h - margin - size, margin + size, h - margin),
            fitz.Rect(w - margin - size, h - margin - size, w - margin, h - margin),
        ]

        for rect in corners:
            # Outer black square + inner white square + center bullseye dot
            page.draw_rect(rect, color=(0, 0, 0), fill=(0, 0, 0))
            inner = fitz.Rect(rect.x0 + 3, rect.y0 + 3, rect.x1 - 3, rect.y1 - 3)
            page.draw_rect(inner, color=(1, 1, 1), fill=(1, 1, 1))
            center = fitz.Rect(rect.x0 + 5, rect.y0 + 5, rect.x1 - 5, rect.y1 - 5)
            page.draw_rect(center, color=(0, 0, 0), fill=(0, 0, 0))

    doc.save(output_pdf_path)
    doc.close()
    return output_pdf_path


def align_scanned_form(
    blank_pdf_path: str,
    scanned_img_path: str,
    output_aligned_path: str,
    page_num: int = 0
) -> str:
    """Aligns a camera scan against a specific page of the original blank PDF."""
    template_img = pdf_page_to_image(blank_pdf_path, page_num=page_num, dpi=300)
    scanned_img = cv2.imread(scanned_img_path)

    if scanned_img is None:
        raise ValueError(f"Could not read scanned image at {scanned_img_path}")

    template_gray = cv2.cvtColor(template_img, cv2.COLOR_BGR2GRAY)
    scanned_gray = cv2.cvtColor(scanned_img, cv2.COLOR_BGR2GRAY)

    orb = cv2.ORB_create(nfeatures=6000)
    kp1, des1 = orb.detectAndCompute(template_gray, None)
    kp2, des2 = orb.detectAndCompute(scanned_gray, None)

    if des1 is None or des2 is None:
        raise RuntimeError("Could not detect enough features to align the form.")

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = matcher.match(des1, des2)
    matches = sorted(matches, key=lambda x: x.distance)
    good_matches = matches[: max(int(len(matches) * 0.20), 12)]

    src_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)

    H, _ = cv2.findHomography(dst_pts, src_pts, cv2.RANSAC, 5.0)
    height, width = template_img.shape[:2]
    aligned_img = cv2.warpPerspective(scanned_img, H, (width, height))

    cv2.imwrite(output_aligned_path, aligned_img)
    return output_aligned_path