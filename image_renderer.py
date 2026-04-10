import io
import textwrap
from PIL import Image, ImageDraw, ImageFont

# Try to use a native sans-serif font
try:
    _font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
except:
    try:
        _font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    except:
        _font = ImageFont.load_default()

def render_chat_history(history: list[dict], streaming_content: str = "", width: int = 800) -> bytes:
    """ Renders the complete conversation history + streaming delta into a raw PNG """
    lines = []
    
    # Add User/Assistant prefixes and word wrap
    for msg in history:
        if msg.get("role") == "system": continue
        prefix = "User: " if msg.get("role") == "user" else "Assistant: "
        text = prefix + msg.get("content", "")
        for raw_line in text.split('\n'):
            wrapped = textwrap.wrap(raw_line, width=90)
            if not wrapped: lines.append("")
            else: lines.extend(wrapped)
        lines.append("") # paragraph spacing
        
    if not lines and not streaming_content:
        lines.append("[Secure Vault Memory Initiailzed — Awaiting Input]")
        lines.append("")
        
    if streaming_content:
        text = "Assistant: " + streaming_content
        for raw_line in text.split('\n'):
            wrapped = textwrap.wrap(raw_line, width=90)
            if not wrapped: lines.append("")
            else: lines.extend(wrapped)


    # Calculate height
    # using load_default or TTF, fallback spacing is ~20px per line
    line_height = 24
    height = max(line_height, len(lines) * line_height) + 20

    img = Image.new("RGBA", (width, height), (30, 30, 34, 255))
    draw = ImageDraw.Draw(img)

    y_text = 10
    for line in lines:
        draw.text((10, y_text), line, font=_font, fill=(230, 230, 230, 255))
        y_text += line_height

    # Phase 9: Adversarial OCR Disruption
    import random
    # 1. Dense CRT-style scanlines (Confuses bounding box segmenters)
    for y in range(0, height, random.choice([2, 3, 4])):
        draw.line([(0, y), (width, y)], fill=(20, 20, 24, 100), width=1)
        
    # 2. Zebra vector striping (matches text color to disrupt thresholding)
    for _ in range(height // 15):
        y1 = random.randint(0, height)
        y2 = y1 + random.randint(-10, 10)
        draw.line([(0, y1), (width, y2)], fill=(230, 230, 230, 20), width=1)
        
    # 3. Zalgo / Intersection lines (breaks Connected Component topology)
    for _ in range(width // 40):
        x1 = random.randint(0, width)
        x2 = x1 + random.randint(-15, 15)
        draw.line([(x1, 0), (x2, height)], fill=(40, 40, 45, 180), width=1)

    out = io.BytesIO()
    img.save(out, format="PNG", optimize=False)
    return out.getvalue()
