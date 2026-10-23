import cv2
import numpy as np


def extract_transparent_signature(
    aligned_img_path: str,
    box_2d: list[int],
    output_png_path: str
) -> str:
    """
    Crops a signature or official stamp from the aligned scan using 0-1000
    normalized coordinates, removes the paper background, and saves a transparent PNG.
    """
    img = cv2.imread(aligned_img_path)
    if img is None:
        raise ValueError(f"Cannot read aligned scan at {aligned_img_path}")

    h, w = img.shape[:2]
    ymin, xmin, ymax, xmax = box_2d

    # Convert 0-1000 coordinates to pixel bounds with a small safety margin
    x0 = max(int((xmin / 1000.0) * w) - 4, 0)
    y0 = max(int((ymin / 1000.0) * h) - 4, 0)
    x1 = min(int((xmax / 1000.0) * w) + 4, w)
    y1 = min(int((ymax / 1000.0) * h) + 4, h)

    crop = img[y0:y1, x0:x1]
    if crop.size == 0:
        raise ValueError("Empty signature crop region")

    # Convert to grayscale and threshold to isolate dark/colored ink from white paper
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    _, alpha_mask = cv2.threshold(
        blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )

    # Smooth edges of the ink strokes
    kernel = np.ones((2, 2), np.uint8)
    alpha_mask = cv2.morphologyEx(alpha_mask, cv2.MORPH_OPEN, kernel)

    # Combine original BGR ink colors with the transparent alpha mask
    b, g, r = cv2.split(crop)
    rgba = cv2.merge([b, g, r, alpha_mask])

    cv2.imwrite(output_png_path, rgba)
    return output_png_path