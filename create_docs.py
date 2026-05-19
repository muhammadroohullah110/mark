"""
Mark AI — Branded PDF Generator
1. Playbook: playful, fun, normal audience
2. Documentation: professional, business owners
"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm, cm
from reportlab.lib.colors import HexColor, white, black, Color
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    ListFlowable, ListItem, KeepTogether, HRFlowable, Flowable
)
from reportlab.pdfgen import canvas as pdfcanvas

W, H = A4
OUT_DIR = os.path.dirname(__file__)

# ═══ BRAND COLORS ═══
DEEP_SPACE   = HexColor("#0D1B2A")
PLANET_BLUE  = HexColor("#1B3A5C")
ICE_BLUE     = HexColor("#B3E5FC")
LIGHT_ICE    = HexColor("#E1F5FE")
SNOW         = HexColor("#F5F9FF")
ROBOT_BLUE   = HexColor("#4FC3F7")
MEDIUM_BLUE  = HexColor("#29B6F6")
ACCENT       = HexColor("#FF8C42")
DARK_TEXT     = HexColor("#1A2530")
MID_TEXT      = HexColor("#3A4A5A")
SOFT_GRAY    = HexColor("#8899AA")
CARD_BG      = HexColor("#EDF6FC")
SUCCESS      = HexColor("#43A047")
DANGER       = HexColor("#E53935")
PURPLE       = HexColor("#7E57C2")


# ═══════════════════════════════════════════════════
# CUSTOM FLOWABLES
# ═══════════════════════════════════════════════════

class GradientBanner(Flowable):
    """Full-width gradient banner with text."""
    def __init__(self, text, subtitle="", height=90, colors=(DEEP_SPACE, PLANET_BLUE)):
        Flowable.__init__(self)
        self.text = text
        self.subtitle = subtitle
        self.bh = height
        self.c1, self.c2 = colors
        self.width = W - 72
        self.height = height

    def draw(self):
        c = self.canv
        steps = 40
        sh = self.bh / steps
        for i in range(steps):
            r = i / steps
            red = self.c1.red + (self.c2.red - self.c1.red) * r
            grn = self.c1.green + (self.c2.green - self.c1.green) * r
            blu = self.c1.blue + (self.c2.blue - self.c1.blue) * r
            c.setFillColorRGB(red, grn, blu)
            c.rect(-36, self.bh - (i+1)*sh, self.width + 72, sh + 1, fill=1, stroke=0)
        # Round corners overlay
        c.setFillColor(self.c1)
        c.roundRect(-36, 0, self.width + 72, self.bh, 0, fill=0, stroke=0)
        # Text
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 22)
        c.drawString(10, self.bh - 38, self.text)
        if self.subtitle:
            c.setFillColor(ICE_BLUE)
            c.setFont("Helvetica", 11)
            c.drawString(10, self.bh - 58, self.subtitle)


class ChapterHeader(Flowable):
    """Numbered chapter header with gradient background."""
    def __init__(self, number, title, subtitle=""):
        Flowable.__init__(self)
        self.number = number
        self.title = title
        self.subtitle = subtitle
        self.width = W - 72
        self.height = 75 if subtitle else 60

    def draw(self):
        c = self.canv
        # Background
        c.setFillColor(DEEP_SPACE)
        c.roundRect(-10, 0, self.width + 20, self.height, 12, fill=1, stroke=0)
        # Number badge
        c.setFillColor(ACCENT)
        c.circle(30, self.height / 2, 16, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 13)
        c.drawCentredString(30, self.height / 2 - 5, str(self.number))
        # Title
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 20)
        ty = self.height / 2 + 5 if self.subtitle else self.height / 2 - 5
        c.drawString(55, ty, self.title)
        # Subtitle
        if self.subtitle:
            c.setFillColor(ICE_BLUE)
            c.setFont("Helvetica", 10)
            c.drawString(55, ty - 20, self.subtitle)


class ColorBox(Flowable):
    """Colored rounded box with text content."""
    def __init__(self, title, body, bg_color=CARD_BG, border_color=ICE_BLUE,
                 title_color=DEEP_SPACE, body_color=MID_TEXT,
                 width=None, number="", icon_color=None):
        Flowable.__init__(self)
        self.title = title
        self.body = body
        self.bg = bg_color
        self.border = border_color
        self.title_color = title_color
        self.body_color = body_color
        self.w = width or (W - 72)
        self.number = number
        self.icon_color = icon_color or ACCENT
        # Calculate height
        self._calc_height()

    def _calc_height(self):
        lines = 1
        test_w = self.w - 50
        words = self.body.split()
        line = ""
        for word in words:
            test = line + " " + word if line else word
            if len(test) * 5.5 < test_w:
                line = test
            else:
                lines += 1
                line = word
        self.height = max(60, 40 + lines * 15)
        self.width = self.w

    def draw(self):
        c = self.canv
        c.setFillColor(self.bg)
        c.setStrokeColor(self.border)
        c.setLineWidth(1)
        c.roundRect(0, 0, self.w, self.height, 10, fill=1, stroke=1)

        x_start = 20
        if self.number:
            c.setFillColor(self.icon_color)
            c.circle(22, self.height - 22, 12, fill=1, stroke=0)
            c.setFillColor(white)
            c.setFont("Helvetica-Bold", 10)
            c.drawCentredString(22, self.height - 26, self.number)
            x_start = 44

        c.setFillColor(self.title_color)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(x_start, self.height - 24, self.title)

        c.setFillColor(self.body_color)
        c.setFont("Helvetica", 10)
        words = self.body.split()
        line = ""
        ly = self.height - 42
        mw = self.w - x_start - 20
        for word in words:
            test = line + " " + word if line else word
            if c.stringWidth(test, "Helvetica", 10) < mw:
                line = test
            else:
                c.drawString(x_start, ly, line)
                ly -= 14
                line = word
        if line:
            c.drawString(x_start, ly, line)


class LayerBar(Flowable):
    """Colored layer bar for the 7-layer brain visual."""
    def __init__(self, number, name, desc, color):
        Flowable.__init__(self)
        self.number = number
        self.name = name
        self.desc = desc
        self.color = color
        self.width = W - 72
        self.height = 42

    def draw(self):
        c = self.canv
        c.setFillColor(self.color)
        c.roundRect(0, 0, self.width, self.height, 8, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(14, self.height - 16, f"Layer {self.number}")
        c.setFont("Helvetica-Bold", 11)
        c.drawString(90, self.height - 16, self.name)
        c.setFont("Helvetica", 9)
        c.drawString(14, self.height - 32, self.desc)


class StatCard(Flowable):
    """Stats card for the numbers page."""
    def __init__(self, number, label, sub, width=150):
        Flowable.__init__(self)
        self.number = number
        self.label = label
        self.sub = sub
        self.width = width
        self.height = 90

    def draw(self):
        c = self.canv
        c.setFillColor(PLANET_BLUE)
        c.setStrokeColor(ROBOT_BLUE)
        c.setLineWidth(1.5)
        c.roundRect(0, 0, self.width, self.height, 12, fill=1, stroke=1)
        c.setFillColor(ACCENT)
        c.setFont("Helvetica-Bold", 24)
        c.drawCentredString(self.width/2, 58, self.number)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 11)
        c.drawCentredString(self.width/2, 38, self.label)
        c.setFillColor(ICE_BLUE)
        c.setFont("Helvetica", 8)
        c.drawCentredString(self.width/2, 18, self.sub)


class AccentLine(Flowable):
    """Simple colored horizontal line."""
    def __init__(self, color=ACCENT, width=60, thickness=3):
        Flowable.__init__(self)
        self.color = color
        self.width = width
        self.height = thickness + 4
        self.thickness = thickness

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.roundRect(0, 0, self.width, self.thickness, 1, fill=1, stroke=0)


# ═══════════════════════════════════════════════════
# COVER PAGE BUILDER (canvas-based for full control)
# ═══════════════════════════════════════════════════

def draw_cover(c, title, subtitle, tagline, version_text, is_playful=False):
    """Draw a full cover page with gradient, planets, robot."""
    import random
    # Full gradient background
    steps = 60
    sh = H / steps
    c1, c2 = DEEP_SPACE, PLANET_BLUE
    for i in range(steps):
        r = i / steps
        red = c1.red + (c2.red - c1.red) * r
        grn = c1.green + (c2.green - c1.green) * r
        blu = c1.blue + (c2.blue - c1.blue) * r
        c.setFillColorRGB(red, grn, blu)
        c.rect(0, H - (i+1)*sh, W, sh + 1, fill=1, stroke=0)

    # Stars
    random.seed(42)
    for _ in range(45):
        sx, sy = random.uniform(20, W-20), random.uniform(80, H-80)
        sz = random.uniform(0.8, 2.5)
        c.setFillColorRGB(1, 1, 1, random.uniform(0.1, 0.45))
        c.circle(sx, sy, sz, fill=1, stroke=0)

    # Planet 1 (top right)
    c.setFillColor(HexColor("#4FC3F7"))
    c.circle(W - 85, H - 130, 40, fill=1, stroke=0)
    c.setFillColor(HexColor("#81D4FA"))
    c.circle(W - 92, H - 122, 30, fill=1, stroke=0)

    # Planet 2 (left)
    c.setFillColor(ACCENT)
    c.circle(70, 240, 22, fill=1, stroke=0)
    c.setFillColor(HexColor("#FFB74D"))
    c.circle(65, 245, 16, fill=1, stroke=0)

    # Small planet
    c.setFillColor(MEDIUM_BLUE)
    c.circle(W - 160, 320, 10, fill=1, stroke=0)

    # Robot icon
    robot_y = H - 260
    sz = 55
    c.setFillColor(ROBOT_BLUE)
    c.roundRect(W/2 - sz/2, robot_y - sz/2, sz, sz, 10, fill=1, stroke=0)
    # Eyes
    c.setFillColor(white)
    c.circle(W/2 - 12, robot_y + 6, 6, fill=1, stroke=0)
    c.circle(W/2 + 12, robot_y + 6, 6, fill=1, stroke=0)
    # Pupils
    c.setFillColor(DEEP_SPACE)
    c.circle(W/2 - 10, robot_y + 7, 2.5, fill=1, stroke=0)
    c.circle(W/2 + 14, robot_y + 7, 2.5, fill=1, stroke=0)
    # Mouth
    if is_playful:
        # Smile
        c.setStrokeColor(white)
        c.setLineWidth(2.5)
        p = c.beginPath()
        p.arc(W/2 - 12, robot_y - 18, W/2 + 12, robot_y - 6, 0, -180)
        c.drawPath(p, stroke=1, fill=0)
    else:
        c.setStrokeColor(white)
        c.setLineWidth(2)
        c.line(W/2 - 10, robot_y - 10, W/2 + 10, robot_y - 10)
    # Antenna
    c.setStrokeColor(ROBOT_BLUE)
    c.setLineWidth(2)
    c.line(W/2, robot_y + sz/2, W/2, robot_y + sz/2 + 15)
    c.setFillColor(ACCENT)
    c.circle(W/2, robot_y + sz/2 + 18, 4, fill=1, stroke=0)

    # Title
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 44)
    c.drawCentredString(W/2, H - 350, title)

    # Subtitle
    c.setFillColor(ROBOT_BLUE)
    c.setFont("Helvetica", 17)
    c.drawCentredString(W/2, H - 380, subtitle)

    # Tagline
    c.setFillColor(ICE_BLUE)
    c.setFont("Helvetica-Oblique", 12)
    c.drawCentredString(W/2, H - 425, tagline)

    # Accent line
    c.setFillColor(ACCENT)
    c.roundRect(W/2 - 40, 105, 80, 3, 1.5, fill=1, stroke=0)

    # Version
    c.setFillColor(SOFT_GRAY)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, 85, version_text)


def draw_back_cover(c):
    """Draw a simple back cover."""
    steps = 60
    sh = H / steps
    c1, c2 = DEEP_SPACE, PLANET_BLUE
    for i in range(steps):
        r = i / steps
        red = c1.red + (c2.red - c1.red) * r
        grn = c1.green + (c2.green - c1.green) * r
        blu = c1.blue + (c2.blue - c1.blue) * r
        c.setFillColorRGB(red, grn, blu)
        c.rect(0, H - (i+1)*sh, W, sh + 1, fill=1, stroke=0)

    import random
    random.seed(99)
    for _ in range(35):
        sx, sy = random.uniform(20, W-20), random.uniform(80, H-80)
        c.setFillColorRGB(1, 1, 1, random.uniform(0.1, 0.4))
        c.circle(sx, sy, random.uniform(0.8, 2.2), fill=1, stroke=0)

    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 32)
    c.drawCentredString(W/2, H/2 + 30, "Mark AI")

    c.setFillColor(ROBOT_BLUE)
    c.setFont("Helvetica", 14)
    c.drawCentredString(W/2, H/2, "Your Website's New Best Friend")

    c.setFillColor(ICE_BLUE)
    c.setFont("Helvetica-Oblique", 11)
    c.drawCentredString(W/2, H/2 - 50, "Install. Set your API key. Watch Mark sell.")

    c.setFillColor(ACCENT)
    c.roundRect(W/2 - 35, H/2 - 70, 70, 3, 1.5, fill=1, stroke=0)

    c.setFillColor(SOFT_GRAY)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W/2, 55, "Built by Arkin  |  Powered by Groq AI  |  2025")


# ═══════════════════════════════════════════════════
# STYLES
# ═══════════════════════════════════════════════════

def make_styles(is_playful=False):
    body_font_size = 11 if is_playful else 10.5
    return {
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=22,
                             textColor=DEEP_SPACE, spaceAfter=6, spaceBefore=16,
                             leading=26),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=15,
                             textColor=PLANET_BLUE, spaceAfter=6, spaceBefore=14,
                             leading=19),
        "h3": ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=12,
                             textColor=DEEP_SPACE, spaceAfter=4, spaceBefore=10,
                             leading=15),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=body_font_size,
                               textColor=MID_TEXT, spaceAfter=8, leading=16,
                               alignment=TA_JUSTIFY),
        "body_center": ParagraphStyle("body_center", fontName="Helvetica", fontSize=body_font_size,
                                      textColor=MID_TEXT, spaceAfter=8, leading=16,
                                      alignment=TA_CENTER),
        "callout": ParagraphStyle("callout", fontName="Helvetica-Bold", fontSize=11,
                                  textColor=PLANET_BLUE, spaceAfter=4, spaceBefore=4,
                                  leading=15, leftIndent=10),
        "bullet": ParagraphStyle("bullet", fontName="Helvetica", fontSize=10.5,
                                 textColor=MID_TEXT, spaceAfter=4, leading=14,
                                 leftIndent=24, bulletIndent=10),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=9,
                                textColor=SOFT_GRAY, spaceAfter=4, leading=12),
        "label_bold": ParagraphStyle("label_bold", fontName="Helvetica-Bold", fontSize=10.5,
                                     textColor=DEEP_SPACE, spaceAfter=2, leading=14),
        "label_body": ParagraphStyle("label_body", fontName="Helvetica", fontSize=10,
                                     textColor=MID_TEXT, spaceAfter=6, leading=14,
                                     leftIndent=12),
        "toc_num": ParagraphStyle("toc_num", fontName="Helvetica-Bold", fontSize=12,
                                  textColor=ACCENT, leading=16),
        "toc_title": ParagraphStyle("toc_title", fontName="Helvetica-Bold", fontSize=12,
                                    textColor=DEEP_SPACE, leading=16),
        "toc_sub": ParagraphStyle("toc_sub", fontName="Helvetica", fontSize=9,
                                  textColor=SOFT_GRAY, leading=12),
    }


# ═══════════════════════════════════════════════════
# PAGE TEMPLATES
# ═══════════════════════════════════════════════════

def snow_bg(canvas, doc):
    """Snow/white background for inner pages."""
    canvas.saveState()
    canvas.setFillColor(SNOW)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    # Subtle top accent line
    canvas.setFillColor(ICE_BLUE)
    canvas.rect(0, H - 3, W, 3, fill=1, stroke=0)
    # Footer
    canvas.setFillColor(SOFT_GRAY)
    canvas.setFont("Helvetica", 7)
    canvas.drawCentredString(W/2, 25, f"Mark AI  |  Page {doc.page}")
    canvas.setFillColor(ACCENT)
    canvas.roundRect(W/2 - 20, 22, 40, 1.5, 0.75, fill=1, stroke=0)
    canvas.restoreState()


# ═══════════════════════════════════════════════════
# DOCUMENT 1: PLAYBOOK (playful, fun)
# ═══════════════════════════════════════════════════

def create_playbook():
    path = os.path.join(OUT_DIR, "Mark_AI_Playbook.pdf")
    doc = SimpleDocTemplate(path, pagesize=A4,
                            leftMargin=36, rightMargin=36,
                            topMargin=36, bottomMargin=50)
    S = make_styles(is_playful=True)
    story = []
    usable = W - 72

    # ── COVER (manual canvas) ──
    def cover_page(canvas, doc):
        draw_cover(canvas, "MARK AI", "Product Playbook",
                   '"The 3D Robot That Sells For You"',
                   "by Arkin  |  v1.0  |  2025", is_playful=True)

    def first_page(canvas, doc):
        snow_bg(canvas, doc)

    doc.addPageTemplates([])

    # We'll build cover + content via onFirstPage/onLaterPages
    # But SimpleDocTemplate only supports one template, so we use a trick:
    # First flowable triggers cover, then we switch

    # Actually, let's use the proper approach: build cover separately then merge
    # For simplicity, let's do canvas cover + platypus content

    # Build cover PDF separately
    cover_path = os.path.join(OUT_DIR, "_cover_playbook.pdf")
    cc = pdfcanvas.Canvas(cover_path, pagesize=A4)
    draw_cover(cc, "MARK AI", "Product Playbook",
               '"The 3D Robot That Sells For You"',
               "by Arkin  |  v1.0  |  2025", is_playful=True)
    cc.showPage()
    cc.save()

    # ── PAGE: WHAT IS MARK ──
    story.append(ChapterHeader("01", "What is Mark?", "Meet your new tiny employee"))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "Mark is a <b>tiny, adorable 3D robot</b> that lives on your website. "
        "He walks around, waves at visitors, and chats with them like a real person.",
        S["body"]))
    story.append(Paragraph(
        "He is <b>NOT</b> a boring chatbox in a corner. Mark is a <b>character</b>. "
        "He has a personality, a backstory, and he genuinely wants to help your visitors "
        "find what they need... and buy it!",
        S["body"]))
    story.append(Paragraph(
        "Think of him as your <font color='#FF8C42'><b>24/7 AI salesperson</b></font> "
        "who never sleeps, never gets tired, and never asks for a raise.",
        S["body"]))
    story.append(Spacer(1, 14))

    # Feature cards as table
    cards_data = [
        ("Walks & Waves", "Mark physically walks around your website. He waves, jumps when excited, and grabs attention like no chatbot ever could."),
        ("Voice Chat", "Visitors can TALK to Mark with their mic. He listens, understands, and speaks back with a real human-like voice."),
        ("Knows Your Site", "Mark crawls your entire website and learns everything: products, prices, pages. He answers from REAL data, never makes stuff up."),
        ("Sales Brain", "Mark detects buying intent, suggests products, handles objections, and knows when to stop pushing. Smart, not annoying."),
    ]

    for i, (title, body) in enumerate(cards_data):
        story.append(ColorBox(title, body, number=str(i+1),
                              bg_color=CARD_BG, border_color=ICE_BLUE,
                              width=usable))
        story.append(Spacer(1, 8))

    story.append(PageBreak())

    # ── PAGE: HOW IT WORKS ──
    story.append(ChapterHeader("02", "How It Works", "5 steps. 2 minutes. Zero coding."))
    story.append(Spacer(1, 16))

    steps = [
        ("Install the Plugin",
         "WordPress > Plugins > Add New > Search 'Mark AI' > Install > Activate. That's literally it. Mark appears on your site."),
        ("Add Your AI Key",
         "Go to Mark AI settings. Paste your free Groq API key from console.groq.com. This powers Mark's brain. Takes 30 seconds."),
        ("Mark Learns Your Site",
         "Mark automatically crawls all your pages, reads your products, about page, everything. No manual training needed. He just knows."),
        ("Visitors Meet Mark",
         "A cute 3D robot appears on your website. He walks, waves, and says hello. Visitors click him and start chatting!"),
        ("Mark Sells For You",
         "Mark recommends products, answers questions, handles objections, and guides visitors to buy. You see all conversations in your dashboard."),
    ]

    for i, (title, body) in enumerate(steps):
        color = [ROBOT_BLUE, MEDIUM_BLUE, PLANET_BLUE, SUCCESS, ACCENT][i]
        story.append(ColorBox(title, body, number=str(i+1),
                              icon_color=color, bg_color=SNOW,
                              border_color=color, width=usable))
        story.append(Spacer(1, 6))

    story.append(Spacer(1, 10))
    story.append(ColorBox("Zero Configuration!", "Mark auto-registers with the backend on activation. No URLs to set, no secrets to match, no technical setup. Just install and go!",
                          bg_color=ROBOT_BLUE, border_color=ROBOT_BLUE,
                          title_color=white, body_color=white, width=usable))

    story.append(PageBreak())

    # ── PAGE: 7-LAYER BRAIN ──
    story.append(ChapterHeader("03", "Mark's 7-Layer Brain", "How he thinks (and why he never lies)"))
    story.append(Spacer(1, 16))

    layers = [
        ("Identity", "Knows he's a cute robot that crash-landed on your website and decided to stay.", ROBOT_BLUE),
        ("Site Awareness", "Knows YOUR website name, URL, and what kind of business you run.", MEDIUM_BLUE),
        ("Personality", "Friendly? Professional? Playful? You pick. He adapts his entire tone.", PLANET_BLUE),
        ("Conversation IQ", "Detects what visitors want: browsing, buying, asking, or just chatting.", HexColor("#26A69A")),
        ("Anti-Hallucination", "NEVER makes up products, prices, or policies. Only says what's actually true.", DANGER),
        ("Sales Intelligence", "Cross-sell, objection handling, urgency triggers, lead capture. All configurable.", ACCENT),
        ("Voice Format", "Short, natural responses. No essays. Talks like a human, not a robot.", PURPLE),
    ]

    for i, (name, desc, color) in enumerate(layers):
        story.append(LayerBar(i+1, name, desc, color))
        story.append(Spacer(1, 5))

    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "<i>Each layer works together to make Mark the smartest website companion ever built.</i>",
        S["body_center"]))

    story.append(PageBreak())

    # ── PAGE: BY THE NUMBERS ──
    story.append(ChapterHeader("04", "By The Numbers", "Real stats, no fluff"))
    story.append(Spacer(1, 20))

    stats = [
        ("0.29 MB", "Plugin Size", "99.5% smaller than v0"),
        ("51/51", "Tests Passed", "Real tests, no fakes"),
        ("7 Layers", "AI Brain", "Sales-aware intelligence"),
        ("0 Config", "Setup Steps", "Install and it works"),
        ("24/7", "Sales Coverage", "Never sleeps, never quits"),
        ("3D", "Robot Character", "Not a boring chat widget"),
    ]

    # Stats as 3x2 table of StatCard flowables
    row1 = [StatCard(s[0], s[1], s[2], width=usable/3 - 10) for s in stats[:3]]
    row2 = [StatCard(s[0], s[1], s[2], width=usable/3 - 10) for s in stats[3:]]

    stats_table = Table([row1, row2],
                        colWidths=[usable/3]*3,
                        rowHeights=[100, 100])
    stats_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(stats_table)

    story.append(Spacer(1, 30))
    story.append(Paragraph(
        "<font color='#FF8C42' size='14'><b>Ready to deploy Mark?</b></font>",
        S["body_center"]))
    story.append(Paragraph(
        "Your visitors are waiting to meet their new favorite robot.",
        S["body_center"]))

    # Build content pages
    doc.build(story, onFirstPage=snow_bg, onLaterPages=snow_bg)

    # Merge cover + content
    from pypdf import PdfWriter, PdfReader
    writer = PdfWriter()
    cover_reader = PdfReader(cover_path)
    writer.add_page(cover_reader.pages[0])
    content_reader = PdfReader(path)
    for page in content_reader.pages:
        writer.add_page(page)
    with open(path, "wb") as f:
        writer.write(f)
    os.remove(cover_path)

    print(f"Playbook: {path} ({len(content_reader.pages) + 1} pages)")
    return path


# ═══════════════════════════════════════════════════
# DOCUMENT 2: DOCUMENTATION (professional, business owners)
# ═══════════════════════════════════════════════════

def create_documentation():
    path = os.path.join(OUT_DIR, "Mark_AI_Documentation.pdf")
    doc = SimpleDocTemplate(path, pagesize=A4,
                            leftMargin=42, rightMargin=42,
                            topMargin=42, bottomMargin=55)
    S = make_styles(is_playful=False)
    story = []
    usable = W - 84

    # Cover
    cover_path = os.path.join(OUT_DIR, "_cover_docs.pdf")
    cc = pdfcanvas.Canvas(cover_path, pagesize=A4)
    draw_cover(cc, "MARK AI", "Official Documentation",
               "Everything you need to know about your 3D AI sales companion",
               "Version 1.0  |  by Arkin  |  2025", is_playful=False)
    cc.showPage()
    cc.save()

    # ── TABLE OF CONTENTS ──
    story.append(Paragraph("Contents", S["h1"]))
    story.append(AccentLine(ACCENT, 70))
    story.append(Spacer(1, 16))

    toc = [
        ("1", "The Story of Mark", "How a tiny robot became your best salesperson"),
        ("2", "What Mark Actually Does", "Features explained in plain English"),
        ("3", "How to Install Mark", "3 steps, 2 minutes, zero coding"),
        ("4", "The Settings Dashboard", "Every button and toggle explained"),
        ("5", "Mark's 7-Layer Brain", "How he thinks and why he never lies"),
        ("6", "Sales Intelligence", "How Mark helps sell without being pushy"),
        ("7", "Voice Chat", "How Mark listens and speaks"),
        ("8", "Analytics & Conversations", "Track what visitors ask"),
        ("9", "For Developers", "Technical details for the curious"),
        ("10", "FAQ", "Common questions answered"),
    ]

    for num, title, sub in toc:
        toc_table = Table(
            [[Paragraph(f"<font color='#FF8C42'><b>{num}</b></font>", S["toc_num"]),
              Paragraph(f"<b>{title}</b><br/><font size='9' color='#8899AA'>{sub}</font>", S["toc_title"])]],
            colWidths=[35, usable - 35],
            rowHeights=[36]
        )
        toc_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('LINEBELOW', (0, 0), (-1, -1), 0.5, ICE_BLUE),
        ]))
        story.append(toc_table)

    story.append(PageBreak())

    # ═══ CHAPTER 1: THE STORY ═══
    story.append(ChapterHeader(1, "The Story of Mark", "How a tiny robot became your best salesperson"))
    story.append(Spacer(1, 14))

    ch1 = [
        "Imagine you run a beautiful online store. You have great products, a nice website, and visitors are coming in. But there is a problem: <b>most visitors leave without buying anything</b>. They browse, they look around, and then... they are gone.",
        "In a physical store, you would have a salesperson who greets customers, asks what they are looking for, shows them the right products, and answers their questions. But on a website? Nothing. Just a silent page and maybe a boring chat widget that nobody clicks.",
        "<font color='#FF8C42'><b>That is where Mark comes in.</b></font>",
        "Mark is a tiny 3D robot who <b>lives on your website</b>. He is not a chatbox. He is not a popup. He is a little character that walks around your page, waves at visitors, and starts conversations. When someone clicks on him, he opens a beautiful chat window where visitors can type or even <b>talk with their voice</b>.",
        "Mark is powered by real AI. He reads your entire website, learns your products, your prices, your policies, and then uses that knowledge to help visitors. He <b>never makes stuff up</b>. He never offers discounts you did not approve. He is smart, helpful, and knows exactly when to suggest a product and when to just be friendly.",
        "Mark was built by <b>Arkin</b> to solve one simple problem: e-commerce websites lose sales because they have no one to talk to visitors. Mark fixes that. He is your 24/7 AI salesperson who never sleeps, never gets tired, and never asks for a day off.",
    ]
    for p in ch1:
        story.append(Paragraph(p, S["body"]))
        story.append(Spacer(1, 4))

    story.append(PageBreak())

    # ═══ CHAPTER 2: WHAT MARK DOES ═══
    story.append(ChapterHeader(2, "What Mark Actually Does", "Features explained in plain English"))
    story.append(Spacer(1, 14))

    features = [
        ("3D Robot Character",
         "Mark is a fully 3D animated robot that appears on your website. He walks left and right, waves when visitors arrive, and jumps when he gets excited. He is designed to <b>grab attention</b> and make visitors curious enough to interact."),
        ("Smart Chat",
         "When visitors click on Mark, a chat window opens. They can type questions and Mark answers instantly. He knows about your products, your pages, and your business because he has already <b>read your entire website</b>."),
        ("Voice Conversations",
         "Visitors can press and hold the microphone button to <b>talk to Mark with their voice</b>. Mark understands what they say, thinks about the answer, and speaks back using a natural-sounding voice. It feels like talking to a real person."),
        ("Sales Intelligence",
         "Mark is not just a helper. He is a <b>salesperson</b>. When a visitor shows interest in a product, Mark can suggest complementary items, handle objections, and guide them towards making a purchase. You control how aggressive or gentle his sales approach is."),
        ("Website Knowledge (RAG)",
         "RAG means Mark <b>reads all your web pages and remembers them</b>. When a visitor asks a question, Mark searches his memory first and only answers based on real data from YOUR site. He never invents products or prices."),
        ("Analytics Dashboard",
         "Every conversation Mark has is logged. You can see what visitors asked, what Mark replied, which languages they spoke, and how many conversations happened. This data helps you <b>understand what your visitors want</b>."),
    ]

    for title, desc in features:
        story.append(Paragraph(f"<font color='#1B3A5C'><b>{title}</b></font>", S["h3"]))
        story.append(Paragraph(desc, S["body"]))
        story.append(Spacer(1, 4))

    story.append(PageBreak())

    # ═══ CHAPTER 3: INSTALLATION ═══
    story.append(ChapterHeader(3, "How to Install Mark", "3 steps, 2 minutes, zero coding"))
    story.append(Spacer(1, 14))

    install = [
        ("Step 1: Install the Plugin",
         "Go to your WordPress dashboard. Click <b>Plugins > Add New</b>. Search for 'Mark AI' in the search bar. Click Install Now, then click Activate. That is it. Mark is now on your website."),
        ("Step 2: Get a Groq API Key (Free)",
         "Mark's brain runs on Groq AI. Go to <b>console.groq.com</b> and create a free account. Copy your API key. Go to Mark AI settings in WordPress and paste the key. This powers Mark's ability to think and respond."),
        ("Step 3: Watch Mark Work",
         "Visit your website. You will see a small 3D robot walking around at the bottom of the page. Click on him. Type a question about your website. <b>Mark will answer using information from your actual pages</b>. He is already trained on your site."),
    ]

    for i, (title, desc) in enumerate(install):
        story.append(ColorBox(title, desc, number=str(i+1),
                              icon_color=[ROBOT_BLUE, ACCENT, SUCCESS][i],
                              bg_color=SNOW, border_color=ICE_BLUE, width=usable))
        story.append(Spacer(1, 10))

    story.append(Spacer(1, 8))
    story.append(ColorBox(
        "Zero Configuration Required",
        "Mark automatically registers with the backend server when you activate the plugin. No URLs to set, no secrets to configure, no technical knowledge needed. The only thing you need is your Groq API key.",
        bg_color=HexColor("#E8F5E9"), border_color=SUCCESS,
        title_color=SUCCESS, width=usable))

    story.append(PageBreak())

    # ═══ CHAPTER 4: SETTINGS ═══
    story.append(ChapterHeader(4, "The Settings Dashboard", "Every button and toggle explained"))
    story.append(Spacer(1, 14))

    story.append(Paragraph("<b>General Settings</b>", S["h2"]))
    story.append(AccentLine(PLANET_BLUE, 50, 2))
    story.append(Spacer(1, 8))

    gen_settings = [
        ("Groq API Key", "Your AI brain key from console.groq.com. This is the <b>only thing you must set up</b>."),
        ("Widget Position", "Where Mark appears on screen: bottom-right (default) or bottom-left."),
        ("Auto Greet", "Should Mark say hello automatically when someone visits your site? Default: Yes."),
        ("Primary Language", "The language Mark speaks in. Supports English, Urdu, Hindi, and more."),
        ("Accent Color", "The color of Mark's chat window. Match it to your brand colors."),
    ]
    for name, desc in gen_settings:
        story.append(Paragraph(f"<b>{name}</b>", S["label_bold"]))
        story.append(Paragraph(desc, S["label_body"]))

    story.append(Spacer(1, 10))
    story.append(Paragraph("<b>Store Settings</b>", S["h2"]))
    story.append(AccentLine(PLANET_BLUE, 50, 2))
    story.append(Spacer(1, 8))

    store_settings = [
        ("Store Name", "Your business name. Mark uses this when talking about your store."),
        ("Website URL", "Your site URL. Mark uses this to know which pages to learn from."),
        ("Assistant Name", "What the robot calls himself. Default: Mark. Change it to anything you like."),
        ("Personality", "Choose <b>Friendly</b>, <b>Professional</b>, or <b>Playful</b>. Changes Mark's entire communication style."),
        ("Walking", "Turn robot walking animation on or off. Turning it off saves battery on mobile devices."),
        ("Sound Effects", "Turn voice responses on or off. Off means text-only chat, no speaking."),
    ]
    for name, desc in store_settings:
        story.append(Paragraph(f"<b>{name}</b>", S["label_bold"]))
        story.append(Paragraph(desc, S["label_body"]))

    story.append(PageBreak())

    # ═══ CHAPTER 5: 7-LAYER BRAIN ═══
    story.append(ChapterHeader(5, "Mark's 7-Layer Brain", "How he thinks and why he never lies"))
    story.append(Spacer(1, 14))

    brain_layers = [
        ("Layer 1: Identity", "Mark knows he is a small 3D robot who crash-landed on your website and decided to stay. This is not just a backstory. It shapes <b>how</b> he responds. He speaks as a character, not a generic AI.", ROBOT_BLUE),
        ("Layer 2: Site Awareness", "Mark knows the name of your website and what type of business you run. He says <i>'here at Cool Shoes Store'</i> instead of <i>'I do not know what this website is'</i>. He speaks about your site with pride.", MEDIUM_BLUE),
        ("Layer 3: Personality", "You pick Friendly, Professional, or Playful. This changes Mark's tone, humor level, greeting style, and how formal he sounds. Professional Mark is precise. Playful Mark cracks jokes.", PLANET_BLUE),
        ("Layer 4: Conversation IQ", "Mark detects what visitors want: navigation help, product info, general chat, or help with a problem. He tracks conversation stages from greeting through to close.", HexColor("#26A69A")),
        ("Layer 5: Anti-Hallucination", "Mark <b>never</b> invents products, prices, policies, or deals. He only answers based on data he found on your actual website. If he does not know, he redirects the visitor helpfully.", DANGER),
        ("Layer 6: Sales Brain", "Configurable sales modes: <b>Helpful</b> (no selling), <b>Soft Sell</b> (gentle suggestions), <b>Active</b> (proactive recommendations). Includes cross-sell, objection handling, urgency triggers, and lead capture.", ACCENT),
        ("Layer 7: Response Format", "Mark speaks in 1-2 short sentences. No bullet lists, no paragraphs, no markdown. He talks like a real person because he is a voice-first conversational interface.", PURPLE),
    ]

    for title, desc, color in brain_layers:
        story.append(Paragraph(f"<font color='{color.hexval()}'><b>{title}</b></font>", S["h3"]))
        story.append(Paragraph(desc, S["body"]))
        story.append(Spacer(1, 2))

    story.append(PageBreak())

    # ═══ CHAPTER 6: SALES ═══
    story.append(ChapterHeader(6, "Sales Intelligence", "How Mark helps sell without being pushy"))
    story.append(Spacer(1, 14))

    story.append(Paragraph(
        "Mark's sales brain is what makes him special. Unlike a regular chatbot that just answers questions, "
        "Mark actively helps visitors find the right products and guides them towards buying. "
        "But he does it <b>smartly, not aggressively</b>.", S["body"]))
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>Three Sales Modes</b>", S["h2"]))
    story.append(AccentLine(PLANET_BLUE, 50, 2))
    story.append(Spacer(1, 8))

    modes = [
        ("Helpful Only", "Mark only answers questions. He never suggests products on his own. Perfect for support-focused sites.", SUCCESS),
        ("Soft Sell", "When a visitor shows interest, Mark naturally mentions relevant products. One mention, no pressure.", ROBOT_BLUE),
        ("Active", "Mark proactively recommends products with details and benefits. Still respects 'no' immediately.", ACCENT),
    ]
    for name, desc, color in modes:
        story.append(ColorBox(name, desc, bg_color=HexColor(color.hexval()+"18"),
                              border_color=color, title_color=color, width=usable))
        story.append(Spacer(1, 6))

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Smart Features</b>", S["h2"]))
    story.append(AccentLine(PLANET_BLUE, 50, 2))
    story.append(Spacer(1, 8))

    smart = [
        "<b>Cross-sell:</b> When someone asks about shoes, Mark suggests matching socks.",
        "<b>Objection handling:</b> 'Too expensive?' Mark reframes the value without offering discounts.",
        "<b>Back-off rule:</b> If a visitor says 'no thanks' twice, Mark stops suggesting entirely.",
        "<b>Lead capture:</b> Mark can ask for an email if a visitor shows strong buying interest.",
        "<b>Golden rules:</b> Mark NEVER offers discounts, quotes unconfirmed prices, or makes guarantees.",
    ]
    for item in smart:
        story.append(Paragraph(f"•  {item}", S["bullet"]))

    story.append(PageBreak())

    # ═══ CHAPTER 7: VOICE ═══
    story.append(ChapterHeader(7, "Voice Chat", "How Mark listens and speaks"))
    story.append(Spacer(1, 14))

    story.append(Paragraph("<b>Speech-to-Text (Listening)</b>", S["h2"]))
    story.append(AccentLine(PLANET_BLUE, 50, 2))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "When a visitor holds the microphone button and speaks, their voice is sent to Groq's Whisper API "
        "which converts speech to text. Mark then processes the text and responds. "
        "This works in <b>multiple languages</b> automatically.", S["body"]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Text-to-Speech (Speaking)</b>", S["h2"]))
    story.append(AccentLine(PLANET_BLUE, 50, 2))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Mark's voice is powered by <b>Microsoft Edge TTS</b>, which is completely free. "
        "No API key needed. The voice sounds natural and human-like. You can choose from "
        "male and female voices in multiple languages including English, Urdu, and Hindi.", S["body"]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Voice Settings</b>", S["h2"]))
    story.append(AccentLine(PLANET_BLUE, 50, 2))
    story.append(Spacer(1, 6))

    voice_s = [
        ("Voice Type", "Choose different voice options for each language."),
        ("Speaking Speed", "Make Mark talk faster or slower."),
        ("Pitch", "Adjust how high or low Mark's voice sounds."),
        ("Sound Toggle", "Turn voice on or off entirely. When off, Mark is text-only."),
    ]
    for name, desc in voice_s:
        story.append(Paragraph(f"<b>{name}</b> — {desc}", S["bullet"]))

    story.append(PageBreak())

    # ═══ CHAPTER 8: ANALYTICS ═══
    story.append(ChapterHeader(8, "Analytics & Conversations", "Track what visitors ask"))
    story.append(Spacer(1, 14))

    story.append(Paragraph(
        "Every conversation Mark has with your visitors is <b>automatically saved</b>. "
        "You can see all of this data in your WordPress dashboard under the Conversations tab.", S["body"]))
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>What You Can See</b>", S["h2"]))
    story.append(AccentLine(PLANET_BLUE, 50, 2))
    story.append(Spacer(1, 6))

    analytics = [
        "Total conversations (all time, this week, today)",
        "Number of unique visitors who chatted",
        "Language breakdown for each conversation",
        "The last message each visitor sent",
        "What Mark replied",
        "Daily conversation charts to spot trends",
        "Peak hours when visitors chat the most",
    ]
    for item in analytics:
        story.append(Paragraph(f"•  {item}", S["bullet"]))

    story.append(Spacer(1, 10))
    story.append(Paragraph("<b>Why This Matters</b>", S["h2"]))
    story.append(AccentLine(PLANET_BLUE, 50, 2))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "This data is <b>gold for your business</b>. If 50 visitors ask about shipping but your shipping page "
        "is hard to find, now you know. If people keep asking about a product that is out of stock, now you know. "
        "Mark does not just sell. He gives you <b>insights</b> about what your visitors actually want.", S["body"]))

    story.append(PageBreak())

    # ═══ CHAPTER 9: FOR DEVS ═══
    story.append(ChapterHeader(9, "For Developers", "Technical details for the curious"))
    story.append(Spacer(1, 14))

    story.append(Paragraph(
        "<i>You do not need to read this chapter to use Mark. "
        "This is for developers or technically curious people.</i>", S["small"]))
    story.append(Spacer(1, 10))

    tech = [
        ("Frontend", "Three.js for 3D rendering, GLTF robot model, vanilla JavaScript. No React or heavy frameworks. Scripts are deferred for performance."),
        ("Backend", "Python FastAPI hosted on Render. Handles AI chat, voice transcription, text-to-speech, and RAG search."),
        ("AI Model", "Groq's Llama 3.3 70B for chat intelligence. Fast inference, high quality responses."),
        ("RAG Engine", "Custom crawl engine using BeautifulSoup + TF-IDF vectorization with scikit-learn. Crawls up to 120 pages per site."),
        ("Voice", "Groq Whisper for speech-to-text. Microsoft Edge TTS (free) for text-to-speech."),
        ("Database", "WordPress uses MySQL via wpdb. Backend uses SQLite for zero-dependency deployment."),
        ("Security", "Salted password hashing, per-store API tokens, rate limiting, input sanitization, prompt injection blocking, URL validation against XSS."),
        ("Plugin Size", "0.29 MB distributable. 3D model served locally with optional CDN override."),
    ]

    for label, desc in tech:
        story.append(Paragraph(f"<b>{label}</b>", S["label_bold"]))
        story.append(Paragraph(desc, S["label_body"]))

    story.append(PageBreak())

    # ═══ CHAPTER 10: FAQ ═══
    story.append(ChapterHeader(10, "FAQ", "Common questions answered"))
    story.append(Spacer(1, 14))

    faqs = [
        ("Is Mark free?",
         "The Mark plugin is free to install. You need a free Groq API key to power the AI. Voice (Edge TTS) is also completely free."),
        ("Does Mark work on mobile?",
         "Yes. Mark works on all devices. On mobile, walking animations are automatically reduced to save battery."),
        ("Can Mark speak other languages?",
         "Yes. Mark supports multiple languages including Urdu, Hindi, Arabic, and more. He auto-detects the language visitors use."),
        ("Will Mark slow down my website?",
         "No. Mark's plugin is only 0.29 MB. All scripts load with 'defer' so they do not block your page. The 3D model loads in the background."),
        ("Can Mark offer discounts?",
         "No, and this is by design. Mark never offers discounts, promo codes, or deals unless you configure specific CTAs. He will not make promises he cannot keep."),
        ("What if Mark does not know the answer?",
         "He says so honestly. He will redirect the visitor to the right page or suggest contacting you directly. He never invents information."),
        ("Can I change Mark's personality?",
         "Yes. Choose Friendly, Professional, or Playful in your settings. Each option changes his tone, humor, and communication style completely."),
        ("How does Mark learn about my products?",
         "Mark automatically crawls your website pages when you activate the plugin. He reads everything and stores it. You can trigger a re-crawl anytime."),
    ]

    for q, a in faqs:
        story.append(Paragraph(f"<font color='#1B3A5C'><b>{q}</b></font>", S["h3"]))
        story.append(Paragraph(a, S["body"]))
        story.append(Spacer(1, 4))

    # Build
    doc.build(story, onFirstPage=snow_bg, onLaterPages=snow_bg)

    # Merge cover + content + back cover
    from pypdf import PdfWriter, PdfReader

    back_path = os.path.join(OUT_DIR, "_back_docs.pdf")
    bc = pdfcanvas.Canvas(back_path, pagesize=A4)
    draw_back_cover(bc)
    bc.showPage()
    bc.save()

    writer = PdfWriter()
    for p in [cover_path, path, back_path]:
        reader = PdfReader(p)
        for page in reader.pages:
            writer.add_page(page)
    with open(path, "wb") as f:
        writer.write(f)
    os.remove(cover_path)
    os.remove(back_path)

    total = len(PdfReader(path).pages)
    print(f"Documentation: {path} ({total} pages)")
    return path


if __name__ == "__main__":
    p = create_playbook()
    d = create_documentation()
    print(f"\nDone!")
    print(f"  1. {p}")
    print(f"  2. {d}")
