import os
import json
import time
import random
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import APIError
from PIL import Image
from pydantic import BaseModel, Field

load_dotenv()

# Priority list of models: if the primary model hits a 503 traffic spike,
# the extractor automatically falls back to the next available model.
MODEL_FALLBACK_CHAIN = [
    "gemini-3.8-flash",
    "gemini-3.8-pro",
    "gemini-2.5-pro",
]


class ExtractedField(BaseModel):
    field_label: str = Field(
        description="The printed label next to the field (e.g., 'Full Name', 'Applicant Signature')"
    )
    handwritten_value: str = Field(
        description="The transcribed handwritten text, '✓' for checked boxes, or '[Real Ink Signature]' if it is a handwritten signature/stamp"
    )
    field_type: str = Field(description="One of: 'text', 'checkbox', or 'signature'")
    box_2d: list[int] = Field(
        description="Normalized bounding box [ymin, xmin, ymax, xmax] on a 0-1000 scale where the text or signature sits on Image 1"
    )


class FormExtractionResult(BaseModel):
    fields: list[ExtractedField]


def optimize_image_for_vision(img_path: str, max_dim: int = 1600) -> Image.Image:
    """
    Downscales huge 300-DPI scans in memory before sending to Gemini.
    Because coordinates are normalized (0-1000), resizing does not affect accuracy
    and drastically reduces 503 server timeouts.
    """
    img = Image.open(img_path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    return img


def extract_handwritten_fields(blank_img_path: str, aligned_scan_path: str) -> dict:
    """
    Extracts handwritten fields with automatic exponential backoff retries
    and multi-model fallback to prevent 503 UNAVAILABLE errors.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is missing in .env")

    client = genai.Client(api_key=api_key)

    # Optimize image payload size to reduce server load
    blank_img = optimize_image_for_vision(blank_img_path)
    aligned_img = optimize_image_for_vision(aligned_scan_path)

    prompt = """
    You are a precision document reconstruction engine.
    Image 1 is the original BLANK form template.
    Image 2 is the ALIGNED scan of the same form after a human filled it out by hand.

    Task:
    1. Identify every field where the user wrote handwritten text, numbers, checked a box, or signed their signature/stamp in Image 2 that is empty in Image 1.
    2. For normal handwriting, set field_type='text' and transcribe the handwriting into clean text.
    3. For ticked checkboxes, set field_type='checkbox' and handwritten_value='✓'.
    4. For handwritten signatures or official ink stamps, set field_type='signature', handwritten_value='[Real Ink Signature]', and make sure box_2d tightly encloses the entire signature/stamp region on a 0-1000 scale.
    5. Return box_2d as [ymin, xmin, ymax, xmax] normalized from 0 to 1000.
    """

    last_error = None
    max_retries_per_model = 3

    for model_name in MODEL_FALLBACK_CHAIN:
        for attempt in range(1, max_retries_per_model + 1):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[blank_img, aligned_img, prompt],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=FormExtractionResult,
                        temperature=0.1,
                    ),
                )
                return json.loads(response.text)

            except APIError as e:
                last_error = e
                # Retry on 503 (Unavailable/Overloaded), 429 (Rate Limit), or 500 (Internal)
                if e.code in (503, 429, 500):
                    wait_time = (2 ** attempt) + random.uniform(0.3, 1.2)
                    print(
                        f"[{model_name}] Server busy ({e.code}). Retrying attempt {attempt}/{max_retries_per_model} in {wait_time:.1f}s..."
                    )
                    time.sleep(wait_time)
                    continue
                # If model is 404 Not Found on this account tier, jump immediately to next fallback model
                elif e.code == 404:
                    print(f"[{model_name}] Model not available on this tier, switching fallback...")
                    break
                else:
                    raise e
            except Exception as e:
                last_error = e
                wait_time = 2 * attempt
                time.sleep(wait_time)

    raise RuntimeError(
        f"All Gemini models are currently experiencing peak traffic. Last error: {last_error}"
    )