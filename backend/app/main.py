import os
import json
import uuid
import time
import shutil
import cv2
import pymupdf as fitz
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.services.aligner import (
    pdf_page_to_image,
    align_scanned_form,
    get_pdf_page_count,
    stamp_fiducial_markers,
)
from app.services.extractor import extract_handwritten_fields
from app.services.pdf_builder import stamp_clean_pdf
from app.services.exporters import (
    export_to_excel,
    export_to_word,
    append_to_master_template_excel,
)

app = FastAPI(title="Form Reconstructor Pro API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
OUTPUT_DIR = "outputs"
TEMPLATES_DIR = "templates"
TEMPLATES_INDEX = os.path.join(TEMPLATES_DIR, "index.json")

for d in [UPLOAD_DIR, OUTPUT_DIR, TEMPLATES_DIR]:
    os.makedirs(d, exist_ok=True)


def load_templates_index() -> list[dict]:
    if not os.path.exists(TEMPLATES_INDEX):
        return []
    with open(TEMPLATES_INDEX, "r", encoding="utf-8") as f:
        return json.load(f)


def save_templates_index(data: list[dict]):
    with open(TEMPLATES_INDEX, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def ensure_pdf_matches_scan_count(blank_pdf_path: str, num_scans: int):
    """
    If a user uploads more scanned pages than the blank PDF has (e.g. 5 scans of a 1-page form),
    automatically duplicate the template pages so all 5 scans are reconstructed into a neat 5-page PDF.
    """
    doc = fitz.open(blank_pdf_path)
    orig_count = doc.page_count
    if num_scans > orig_count:
        out_doc = fitz.open()
        for i in range(num_scans):
            out_doc.insert_pdf(doc, from_page=i % orig_count, to_page=i % orig_count)
        doc.close()
        out_doc.save(blank_pdf_path)
        out_doc.close()
    else:
        doc.close()


class FieldItem(BaseModel):
    page_num: int = 0
    field_label: str
    handwritten_value: str
    field_type: str
    box_2d: list[int]
    offset_x: float = 0.0
    offset_y: float = 0.0
    font_size: float = 11.0


class ReconstructRequest(BaseModel):
    session_id: str
    template_id: Optional[str] = None
    ink_color: str = "navy"
    font_family: str = "helv"
    fields: list[FieldItem]


# ---------------------------------------------------------
# 1. SAVED TEMPLATES & SMART QR PRINT MODE
# ---------------------------------------------------------
@app.get("/api/templates")
def list_saved_templates():
    return {"templates": load_templates_index()}


@app.post("/api/templates")
async def save_blank_template(
    name: str = Form(...),
    blank_pdf: UploadFile = File(...)
):
    template_id = str(uuid.uuid4())[:8]
    pdf_path = os.path.join(TEMPLATES_DIR, f"{template_id}.pdf")
    fiducial_path = os.path.join(TEMPLATES_DIR, f"{template_id}_qr.pdf")

    with open(pdf_path, "wb") as f:
        shutil.copyfileobj(blank_pdf.file, f)

    stamp_fiducial_markers(pdf_path, fiducial_path)
    pages = get_pdf_page_count(pdf_path)

    index = load_templates_index()
    new_item = {
        "id": template_id,
        "name": name,
        "filename": blank_pdf.filename,
        "pages": pages,
    }
    index.insert(0, new_item)
    save_templates_index(index)
    return new_item


@app.get("/api/templates/{template_id}/qr-pdf")
def download_qr_ready_template(template_id: str):
    fiducial_path = os.path.join(TEMPLATES_DIR, f"{template_id}_qr.pdf")
    if not os.path.exists(fiducial_path):
        raise HTTPException(status_code=404, detail="QR Template not found")
    return FileResponse(
        fiducial_path,
        media_type="application/pdf",
        filename=f"smart_print_{template_id}.pdf",
    )


@app.get("/api/templates/{template_id}/master-excel")
def download_master_template_excel(template_id: str):
    master_xlsx = os.path.join(TEMPLATES_DIR, f"{template_id}_master.xlsx")
    if not os.path.exists(master_xlsx):
        raise HTTPException(status_code=404, detail="No submissions recorded yet.")
    return FileResponse(
        master_xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"master_submissions_{template_id}.xlsx",
    )


@app.post("/api/prepare-qr-pdf")
async def prepare_adhoc_qr_pdf(blank_pdf: UploadFile = File(...)):
    temp_id = str(uuid.uuid4())[:8]
    in_path = os.path.join(UPLOAD_DIR, f"{temp_id}_raw.pdf")
    out_path = os.path.join(OUTPUT_DIR, f"{temp_id}_smart_print.pdf")

    with open(in_path, "wb") as f:
        shutil.copyfileobj(blank_pdf.file, f)

    stamp_fiducial_markers(in_path, out_path)
    return FileResponse(
        out_path,
        media_type="application/pdf",
        filename=f"smart_print_{blank_pdf.filename}",
    )


# ---------------------------------------------------------
# 2. MULTI-DOCUMENT / MULTI-PAGE ALIGNMENT & EXTRACTION
# ---------------------------------------------------------
@app.post("/api/extract")
async def process_and_extract(
    scanned_images: list[UploadFile] = File(...),
    blank_pdf: Optional[UploadFile] = File(None),
    template_id: Optional[str] = Form(None),
):
    session_id = str(uuid.uuid4())
    blank_pdf_path = os.path.join(UPLOAD_DIR, f"{session_id}_blank.pdf")

    try:
        if template_id:
            saved_path = os.path.join(TEMPLATES_DIR, f"{template_id}.pdf")
            if not os.path.exists(saved_path):
                raise HTTPException(status_code=404, detail="Saved template not found.")
            shutil.copyfile(saved_path, blank_pdf_path)
        elif blank_pdf:
            with open(blank_pdf_path, "wb") as f:
                shutil.copyfileobj(blank_pdf.file, f)
        else:
            raise HTTPException(status_code=400, detail="Provide either a blank_pdf or a template_id.")

        # Automatically expand PDF pages if user uploaded 4, 5, or 10+ scans
        num_scans = len(scanned_images)
        ensure_pdf_matches_scan_count(blank_pdf_path, num_scans)

        all_fields = []

        for page_idx in range(num_scans):
            # 1.0s breather between pages to prevent burst rate-limiting (503/429) on multi-page forms
            if page_idx > 0:
                time.sleep(1.0)

            scan_file = scanned_images[page_idx]
            blank_img_path = os.path.join(UPLOAD_DIR, f"{session_id}_page_{page_idx}_blank.png")
            scan_img_path = os.path.join(UPLOAD_DIR, f"{session_id}_page_{page_idx}_scan.jpg")
            aligned_img_path = os.path.join(UPLOAD_DIR, f"{session_id}_page_{page_idx}_aligned.jpg")

            with open(scan_img_path, "wb") as f:
                shutil.copyfileobj(scan_file.file, f)

            blank_cv_img = pdf_page_to_image(blank_pdf_path, page_num=page_idx, dpi=300)
            cv2.imwrite(blank_img_path, blank_cv_img)

            align_scanned_form(blank_pdf_path, scan_img_path, aligned_img_path, page_num=page_idx)

            extraction_data = extract_handwritten_fields(blank_img_path, aligned_img_path)
            for item in extraction_data.get("fields", []):
                item["page_num"] = page_idx
                item["offset_x"] = 0.0
                item["offset_y"] = 0.0
                item["font_size"] = 11.0
                all_fields.append(item)

        # Save session metadata so Recent Uploads can reopen it anytime
        meta_path = os.path.join(OUTPUT_DIR, f"{session_id}_meta.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(
                {"session_id": session_id, "page_count": num_scans, "fields": all_fields},
                f,
                indent=2,
            )

        return {
            "session_id": session_id,
            "page_count": num_scans,
            "fields": all_fields,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/session/{session_id}")
def get_saved_session(session_id: str):
    """Allows clicking a Recent Upload on the dashboard to reload its fields and document."""
    meta_path = os.path.join(OUTPUT_DIR, f"{session_id}_meta.json")
    if not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="Session data not found on server.")
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/session/{session_id}/page/{page_num}/preview-image")
def get_blank_page_preview(session_id: str, page_num: int):
    img_path = os.path.join(UPLOAD_DIR, f"{session_id}_page_{page_num}_blank.png")
    if not os.path.exists(img_path):
        raise HTTPException(status_code=404, detail="Preview image not found")
    return FileResponse(img_path, media_type="image/png")


# ---------------------------------------------------------
# 3. RECONSTRUCT PDF + SERVE SAVED PDF, WORD & EXCEL
# ---------------------------------------------------------
@app.post("/api/reconstruct")
async def reconstruct_all_formats(payload: ReconstructRequest):
    blank_pdf_path = os.path.join(UPLOAD_DIR, f"{payload.session_id}_blank.pdf")
    if not os.path.exists(blank_pdf_path):
        raise HTTPException(status_code=404, detail="Session expired or blank PDF not found.")

    output_pdf_path = os.path.join(OUTPUT_DIR, f"{payload.session_id}_clean.pdf")
    output_xlsx_path = os.path.join(OUTPUT_DIR, f"{payload.session_id}_data.xlsx")
    output_docx_path = os.path.join(OUTPUT_DIR, f"{payload.session_id}_document.docx")
    meta_path = os.path.join(OUTPUT_DIR, f"{payload.session_id}_meta.json")

    try:
        fields_dict = [f.model_dump() for f in payload.fields]

        stamp_clean_pdf(
            blank_pdf_path,
            fields_dict,
            output_pdf_path,
            UPLOAD_DIR,
            payload.session_id,
            ink_color=payload.ink_color,
            font_family=payload.font_family,
        )

        export_to_excel(fields_dict, output_xlsx_path)
        export_to_word(output_pdf_path, fields_dict, output_docx_path)

        # Update stored metadata so reopening from Dashboard keeps latest edits
        page_count = max([f.get("page_num", 0) for f in fields_dict], default=0) + 1
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "session_id": payload.session_id,
                    "page_count": page_count,
                    "fields": fields_dict,
                },
                f,
                indent=2,
            )

        if payload.template_id:
            append_to_master_template_excel(payload.template_id, fields_dict, TEMPLATES_DIR)

        return FileResponse(
            output_pdf_path,
            media_type="application/pdf",
            filename="reconstructed_form.pdf",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/export/{session_id}/pdf")
def download_saved_pdf(session_id: str):
    """Serves the reconstructed PDF when clicking an item in Recent Uploads."""
    path = os.path.join(OUTPUT_DIR, f"{session_id}_clean.pdf")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Saved PDF not found.")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"reconstructed_{session_id[:6]}.pdf",
    )


@app.get("/api/export/{session_id}/excel")
def download_excel(session_id: str):
    path = os.path.join(OUTPUT_DIR, f"{session_id}_data.xlsx")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Excel file not found.")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="reconstructed_form.xlsx",
    )


@app.get("/api/export/{session_id}/word")
def download_word(session_id: str):
    path = os.path.join(OUTPUT_DIR, f"{session_id}_document.docx")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Word file not found.")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="reconstructed_form.docx",
    )