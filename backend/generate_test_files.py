import pymupdf as fitz
import cv2
import numpy as np

# 1. Create a crisp Blank Form PDF
doc = fitz.open()
page = doc.new_page(width=595, height=842)  # A4 size

# Draw Form Header & Corner Anchors
page.insert_text(fitz.Point(50, 60), "APPLICANT REGISTRATION FORM", fontsize=18, fontname="helv")
page.draw_rect(fitz.Rect(40, 35, 555, 800), color=(0, 0, 0), width=1.5)

fields = [
    ("Full Name:", 130),
    ("Email Address:", 190),
    ("Phone Number:", 250),
    ("Department / Role:", 310),
]

for label, y in fields:
    page.insert_text(fitz.Point(60, y), label, fontsize=12, fontname="helv")
    # Draw the blank line where the user writes
    page.draw_line(fitz.Point(190, y + 2), fitz.Point(520, y + 2), color=(0.3, 0.3, 0.3), width=1)

doc.save("sample_blank.pdf")

# 2. Render to image and simulate handwritten text + tilted phone camera scan
pix = page.get_pixmap(dpi=200)
img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n).copy()
img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
doc.close()

scale = 200 / 72.0  # Convert PDF points to 200 DPI pixel coordinates
handwriting = [
    ("Nehemiah Chiwar", int(195 * scale), int(128 * scale)),
    ("nehemiah@example.com", int(195 * scale), int(188 * scale)),
    ("+234 801 234 5678", int(195 * scale), int(248 * scale)),
    ("Full-Stack Engineer", int(195 * scale), int(308 * scale)),
]

for text, x, y in handwriting:
    cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, 0.9, (140, 30, 20), 2, cv2.LINE_AA)

# Slightly rotate/tilt the image to simulate a real phone camera scan
h, w = img.shape[:2]
M = cv2.getRotationMatrix2D((w // 2, h // 2), 2.5, 0.96)
tilted_scan = cv2.warpAffine(img, M, (w, h), borderValue=(235, 235, 235))

cv2.imwrite("sample_filled_scan.jpg", tilted_scan)
print("Created 'sample_blank.pdf' and 'sample_filled_scan.jpg' successfully!")