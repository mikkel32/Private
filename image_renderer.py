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

    out = io.BytesIO()
    img.save(out, format="PNG", optimize=False)
    return out.getvalue()
