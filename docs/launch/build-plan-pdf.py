"""Build Sahulatcart-Plan.pdf, the plain-words version of PLAN.md. Needs: pip install reportlab. Run: python3 docs/launch/build-plan-pdf.py"""
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, KeepTogether, CondPageBreak)

import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Sahulatcart-Plan.pdf")

TEAL = colors.HexColor("#249E87")
GREEN = colors.HexColor("#268D3C")
MINT = colors.HexColor("#E6F8E0")
NAVY = colors.HexColor("#0A0D13")
SLATE = colors.HexColor("#6D7486")
BORDER = colors.HexColor("#E7E9ED")
SURFACE = colors.HexColor("#F6F7F9")
WARN_BG = colors.HexColor("#FFF4E5")
WARN = colors.HexColor("#B45309")

base = dict(fontName="Helvetica", textColor=NAVY, leading=15)
S = {
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=28, leading=34, textColor=NAVY, spaceAfter=6),
    "sub": ParagraphStyle("sub", fontName="Helvetica", fontSize=13, leading=18, textColor=SLATE, spaceAfter=18),
    "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=19, leading=24, textColor=TEAL, spaceBefore=6, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13.5, leading=18, textColor=NAVY, spaceBefore=12, spaceAfter=5),
    "p": ParagraphStyle("p", fontSize=10.5, **base, spaceAfter=7),
    "small": ParagraphStyle("small", fontSize=9, fontName="Helvetica", leading=12.5, textColor=SLATE),
    "cell": ParagraphStyle("cell", fontSize=9.5, fontName="Helvetica", leading=13, textColor=NAVY),
    "cellb": ParagraphStyle("cellb", fontSize=9.5, fontName="Helvetica-Bold", leading=13, textColor=NAVY),
    "head": ParagraphStyle("head", fontSize=9.5, fontName="Helvetica-Bold", leading=13, textColor=colors.white),
    "bul": ParagraphStyle("bul", fontSize=10.5, **base, leftIndent=14, bulletIndent=3, spaceAfter=4),
    "box": ParagraphStyle("box", fontSize=10.5, fontName="Helvetica", leading=15, textColor=NAVY),
    "boxh": ParagraphStyle("boxh", fontSize=11.5, fontName="Helvetica-Bold", leading=15, textColor=GREEN, spaceAfter=4),
}

W = A4[0] - 40 * mm  # usable width


def P(t, st="p"):
    return Paragraph(t, S[st])


def bullets(items):
    return [Paragraph(i, S["bul"], bulletText="•") for i in items]


def box(title, lines, bg=MINT, title_color=GREEN):
    st = ParagraphStyle("bh", parent=S["boxh"], textColor=title_color)
    body = [Paragraph(title, st)] + [Paragraph(l, S["box"]) for l in lines]
    t = Table([[body]], colWidths=[W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.8, title_color),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return KeepTogether([t, Spacer(1, 10)])


def table(header, rows, widths, zebra=True):
    data = [[Paragraph(h, S["head"]) for h in header]]
    for r in rows:
        data.append([Paragraph(c, S["cellb"] if i == 0 else S["cell"]) for i, c in enumerate(r)])
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    if zebra:
        for i in range(1, len(data)):
            if i % 2 == 0:
                style.append(("BACKGROUND", (0, i), (-1, i), SURFACE))
    t.setStyle(TableStyle(style))
    return t


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8.5)
    canvas.setFillColor(SLATE)
    canvas.drawString(20 * mm, 12 * mm, "Sahulatcart - Market-ready plan - 12 October 2026")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(BORDER)
    canvas.line(20 * mm, 16 * mm, A4[0] - 20 * mm, 16 * mm)
    canvas.restoreState()


story = []

# ---------- Cover ----------
story += [Spacer(1, 70),
          P("Sahulatcart", "title"),
          P("The plan to make it a product people can buy", "sub"),
          P("12 October 2026", "small"), Spacer(1, 30)]
story.append(box("What this document is", [
    "This is the one plan for finishing Sahulatcart. It says what we build, in what order, "
    "and what happens on the day Meta approves us.",
    "",
    "It is written in plain words. Technical terms are explained in the glossary on the last page. "
    "The version for engineers, with file names and API calls, is docs/launch/PLAN.md in the code.",
]))
story.append(box("The big idea", [
    "<b>We build the whole product now, and test it using Meta's test setup.</b> "
    "On the day Meta approves us, the only work is changing three settings. No new code.",
    "",
    "This works because Meta approval does not give us any new tools. It only changes <b>who</b> "
    "we are allowed to use the same tools for. Before approval: our own test number and a few "
    "merchants we add as testers. After approval: anyone.",
], bg=SURFACE, title_color=TEAL))
story.append(PageBreak())

# ---------- Where we are ----------
story.append(P("1. Where we are today", "h1"))
story.append(P("Checked against the live system on 12 October 2026."))

story.append(P("Working now, used by real customers", "h2"))
story += bullets([
    "The sales bot: talks in Roman Urdu, finds the product, bargains within the price limits the "
    "merchant sets, answers questions about the shop, understands voice notes, suggests add-ons, "
    "and hands over to a human when needed.",
    "Orders: cash on delivery, and bank transfer with a screenshot the merchant checks.",
    "The merchant portal: dashboard, inbox (with take-over), orders, product catalog (with CSV and "
    "Shopify import, and AI-written descriptions), settings, notifications, sales figures.",
    "Behind the scenes: messages are never lost, stock is reserved properly, daily backups run.",
])
story.append(P("Live data today: 1 merchant, 5 products, 2 conversations, 0 orders. We have not started "
               "the pilot yet.", "small"))

story.append(P("Built for one shop only", "h2"))
story.append(P("Incoming messages already go to the right merchant. But every <b>outgoing</b> message "
               "uses one password-like key stored in a settings file. There is no sign-up page, no "
               "\"Connect WhatsApp\" button, and a new merchant can only be added by hand."))

story.append(P("Missing completely", "h2"))
story.append(table(["What", "Why it matters"], [
    ["Sign-up and \"Connect WhatsApp\"", "A merchant cannot join on their own."],
    ["One key per merchant", "Needed so each shop sends from its own number safely."],
    ["Pre-approved messages (templates)", "If a buyer last wrote more than 24 hours ago, the bot cannot message them at all today."],
    ["Alerts outside the portal", "A merchant only sees a new order while the portal is open."],
    ["Order stages after \"paid\"", "No \"packed\", \"sent\", \"delivered\"."],
    ["Billing", "No plans, no trial, no way to charge merchants."],
], [60 * mm, W - 60 * mm]))
story.append(Spacer(1, 8))

story.append(box("The real blocker is paperwork, not code", [
    "The Meta roadmap from September asked for six things from the owner by 26 September. "
    "They are still open: NTN certificate, full street address, the legal name copied exactly from "
    "the certificate, Gemini billing switched on, a dedicated SIM, a card on the Meta account.",
    "",
    "The website still shows \"To be confirmed\" for the NTN and address. Nothing on the Meta side "
    "can start until these exist. See section 7.",
], bg=WARN_BG, title_color=WARN))
story.append(CondPageBreak(90 * mm))

# ---------- What approval changes ----------
story.append(P("2. What Meta approval changes", "h1"))
story.append(P("Most people think approval unlocks new features. It does not. Here is what actually changes:"))
story.append(table(["", "Before approval (now)", "After approval"], [
    ["App status", "Development", "Live"],
    ["Who can connect a number", "Our test number, plus merchants we add as \"testers\"", "Any merchant"],
    ["Messages allowed", "250 per day per business", "Grows with good behaviour"],
    ["The tools we use", "Same", "Same"],
    ["Our code", "Same", "Same"],
], [40 * mm, (W - 40 * mm) / 2, (W - 40 * mm) / 2]))
story.append(Spacer(1, 10))
story.append(P("So we build and test everything with testers first, send Meta the two short videos it "
               "asks for as soon as those features work, and keep building while Meta reviews."))
story.append(box("Approval day: the whole job", [
    "1. In the Meta dashboard, switch the app from <b>Development</b> to <b>Live</b>.",
    "2. Check that the two permissions show <b>Advanced access</b>.",
    "3. In Railway, set <b>SIGNUP_OPEN = true</b>. Until then, only emails on our list can sign up.",
    "4. One real merchant signs up, connects their number, and sends one message.",
    "",
    "That is all. Everything else in this plan happens before that day.",
]))

# ---------- Two tracks ----------
story.append(CondPageBreak(120 * mm))
story.append(P("3. Two tracks, side by side", "h1"))
story.append(P("<b>Track A</b> is the Meta paperwork. It is mostly waiting, and only the owner can start it. "
               "<b>Track B</b> is building the product. The two meet once: Meta's review (A6) needs the "
               "first two product milestones (B1 and B2) working, because Meta wants a video of the real thing."))
story.append(table(["Weeks", "Track A: Meta", "Track B: Product"], [
    ["1", "A1 Owner sends the paperwork. A2 We publish it on the website.", "B1 Sign-up and Connect WhatsApp"],
    ["2-3", "A3 Business verification (waiting on Meta)", "B1 continues"],
    ["4", "A4 Set up the Meta app. A5 Join the Tech Provider programme. A6 Send App Review.", "B2 Pre-approved messages. Record the two videos."],
    ["5-6", "A6 Meta reviews (about a day, but allow slack)", "B3 Onboarding that checks everything before going live"],
    ["7-8", "A7 Approval day (if all went well)", "B4 What a real shop needs in its first week"],
    ["9-10", "", "B5 Making it safe for many shops"],
    ["11-13", "", "B6 Pilot with 3 to 5 real shops"],
    ["14", "", "B7 Billing"],
], [18 * mm, (W - 18 * mm) / 2, (W - 18 * mm) / 2]))
story.append(Spacer(1, 6))
story.append(P("If Meta is slower than this, Track B keeps going; nothing after B2 waits for Meta. "
               "If Meta is faster, the pilot starts earlier with real merchants instead of testers.", "small"))
story.append(CondPageBreak(90 * mm))

# ---------- Track A ----------
story.append(P("4. Track A: Meta, step by step", "h1"))
story.append(table(["Step", "Who", "What happens", "How long"], [
    ["A1 Paperwork", "Owner", "Send the six items in section 7.", "This week"],
    ["A2 Website", "Engineering", "Put the NTN, street address and exact legal name on the About page and in every footer. Meta compares the website with the documents letter by letter.", "Same day"],
    ["A3 Business verification", "Owner submits, Meta decides", "In Meta Business Manager: type the business details exactly as on the certificate, upload the two documents, confirm a code by phone or email. Then wait. Never resubmit with changed details.", "Hours to a few days"],
    ["A4 Meta app setup", "Engineering, with the owner logged in", "Create the app, attach it to the verified business, fill in the basic settings (icon, privacy, terms, data-deletion pages), create the \"Connect WhatsApp\" configuration, and turn on four webhook alerts (messages, template status, number quality, account changes). Today only one of the four is on.", "Half a day"],
    ["A5 Tech Provider", "Owner", "Accept Meta's platform terms in the developer dashboard.", "Minutes"],
    ["A6 App Review", "Engineering prepares, owner submits", "Ask for exactly two permissions (sending messages, managing accounts). For each: a short written reason and one uncut screen recording of the real product. Needs B1 and B2 done.", "About a day for Meta"],
    ["A7 Approval day", "Owner and engineering", "The four steps in section 2.", "An hour"],
], [28 * mm, 28 * mm, W - 28 * mm - 28 * mm - 26 * mm, 26 * mm]))
story.append(Spacer(1, 10))
story.append(box("If Meta is slow", [
    "The old plan had no fallback. There is one. Numbers that belong to <b>our</b> verified business "
    "can send messages without the extra approval. For the pilot we can give each shop a "
    "Sahulatcart-owned number with the shop's name on it.",
    "",
    "This is a stopgap, not the product: Meta expects a number's display name to match the business "
    "that owns it. The shop moves to its own number as soon as approval lands, and we build the "
    "connect button so that move is a reconnect, not a migration.",
], bg=SURFACE, title_color=TEAL))
story.append(CondPageBreak(90 * mm))

# ---------- Track B ----------
story.append(P("5. Track B: Product, milestone by milestone", "h1"))
story.append(P("Each milestone has one pass-or-fail test. It is not done until that test passes on the "
               "live system, not just on a laptop."))


def milestone(title, weeks, what, why, done):
    parts = [P(f"{title} <font color='#6D7486' size='10'>({weeks})</font>", "h2"),
             P(f"<b>What we build.</b> {what}"),
             P(f"<b>Why.</b> {why}"),
             Table([[Paragraph(f"<b>Done when:</b> {done}", S["box"])]], colWidths=[W],
                   style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), MINT),
                                     ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                                     ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)])),
             Spacer(1, 8)]
    return KeepTogether(parts)


story.append(milestone(
    "B1. Sign-up and \"Connect WhatsApp\"", "3 weeks",
    "A sign-up page with email and password, email confirmation and password reset. The first login "
    "creates the shop automatically. A \"Connect WhatsApp\" button that opens Meta's own connection "
    "window; when the merchant finishes, we store their key safely (encrypted, never shown in the "
    "browser), link their number to their shop, and send one test message. A page that shows whether "
    "the number is connected, its quality rating, and buttons to reconnect or disconnect.",
    "This is the heart of self-service, and the first thing Meta wants to see in the review video.",
    "A tester signs up, connects the test number, sends a message and gets a bot reply. A second "
    "tester cannot see or use the first tester's number.",
))
story.append(milestone(
    "B2. Pre-approved messages (templates)", "1 week",
    "When a shop connects, we automatically create three pre-approved messages on its account: "
    "\"order confirmed\", \"payment verified\", \"payment rejected\". A page shows whether Meta has "
    "approved each one. The bot uses them whenever a buyer's last message is older than 24 hours.",
    "Without these, the bot cannot tell a buyer \"payment verified\" the next day. Today the merchant "
    "gets a note asking them to do it by hand.",
    "A message created from the portal shows as approved in Meta's tools, and a buyer who last wrote "
    "25 hours ago still receives their confirmation. <b>Record the two review videos here.</b>",
))
story.append(milestone(
    "B3. Onboarding that checks before going live", "2 weeks",
    "Today the \"Go live\" button just flips a switch. It becomes seven steps, each checked: shop "
    "details, connect WhatsApp, add at least one product, set delivery areas and charges (a screen "
    "that is missing today), choose COD on or off and add a bank account, choose the bot's name and "
    "greeting, and finally place a test order from your own phone. Two tick boxes at sign-up that Meta "
    "requires: no prohibited goods, and only message customers who contacted you first.",
    "A shop that goes live half set up produces wrong answers and bad reviews, which lowers its "
    "WhatsApp quality rating.",
    "A new tester can only reach \"live\" by finishing all seven steps.",
))
story.append(milestone(
    "B4. What a real shop needs in its first week", "2 weeks",
    "Alerts to the merchant's own WhatsApp (and email) for new orders, payment claims and hand-overs, "
    "with a link into the portal. Order stages: packed, sent, delivered, with the buyer told at "
    "dispatch. Unpaid bank orders cancel themselves after 24 hours and the stock comes back. "
    "A customer who says \"stop\" is never messaged again (today the bot records it and keeps "
    "replying). Small fixes: delete a product, rename the bot, show today's figures in Pakistan time.",
    "These are the things a merchant notices on day one and judges the product by.",
    "A tester places an order with the portal closed and gets a WhatsApp alert within a minute; a bank "
    "order with no screenshot is cancelled after 24 hours.",
))
story.append(milestone(
    "B5. Safe for many shops", "1 to 2 weeks",
    "Error alerts to the owner's inbox when something breaks. A daily AI budget per shop so one busy "
    "shop cannot use up everyone's allowance. Limits on login attempts. A private owner-only page that "
    "lists all shops, their status and lets you suspend one. Tests that prove one shop can never see "
    "another shop's data.",
    "Today a problem in production is only found when someone complains.",
    "A fake error in production reaches the owner's inbox within five minutes.",
))
story.append(milestone(
    "B6. Pilot with 3 to 5 real shops", "2 to 3 weeks",
    "Real shops, real customers. Before approval they join as testers; after approval as normal "
    "accounts. One named person answers merchants on WhatsApp during Pakistan hours.",
    "Nothing replaces real buyers bargaining in real Roman Urdu.",
    "200 conversations and 30 orders with zero wrong prices, zero duplicate orders and zero data "
    "leaks between shops. Any of those three above zero pauses new sign-ups until fixed.",
))
story.append(milestone(
    "B7. Billing", "1 to 2 weeks",
    "A 30-day free pilot, then a fixed monthly plan in rupees with a limit on conversations. A usage "
    "page. Invoices paid by bank transfer to our account and marked paid by hand. No payment gateway "
    "at first. A shop whose plan has run out switches to hand-over-only; it is never silently cut off.",
    "Charging comes last because the pilot tells us what to charge.",
    "A shop on an expired plan still receives messages and the merchant sees why the bot stopped.",
))
story.append(CondPageBreak(90 * mm))

# ---------- Timeline & decisions ----------
story.append(P("6. How long it takes", "h1"))
story.append(P("With one full-time engineer. Weeks on the calendar, not working days."))
story.append(table(["Milestone", "Weeks", "Finished by week"], [
    ["B1 Sign-up and Connect WhatsApp", "3", "3"],
    ["B2 Pre-approved messages, then App Review sent", "1", "4"],
    ["B3 Onboarding", "2", "6"],
    ["B4 First-week needs", "2", "8"],
    ["B5 Safe for many shops", "1 to 2", "10"],
    ["B6 Pilot", "2 to 3", "13"],
    ["B7 Billing", "1 to 2", "14"],
], [W - 60 * mm, 30 * mm, 30 * mm]))
story.append(Spacer(1, 6))
story.append(P("Meta's own waiting time fits inside weeks 1 to 6 if the paperwork lands this week. Every "
               "week the paperwork slips is a week later that real merchants can join, but the building "
               "work does not wait.", "small"))

story.append(CondPageBreak(110 * mm))
story.append(P("Decisions already made", "h1"))
story.append(P("Made so that nobody is waiting on them. Each can be changed, but each has a reason."))
story.append(table(["Decision", "Reason"], [
    ["Merchants log in with email and password, not Facebook", "Fewer things for Meta to review. The Connect WhatsApp button already handles the Facebook part."],
    ["One owner, one shop, one number per account", "Team members and extra numbers come after billing."],
    ["Three pre-approved messages per shop, created automatically", "Merchants should not have to write or submit templates."],
    ["Merchants pay Meta directly for conversations", "As a Tech Provider we cannot carry their Meta bills."],
    ["Roman Urdu only at launch", "It is the market. English and Urdu script can come later."],
    ["Our own subscription is paid by bank transfer at first", "No gateway to integrate before we know the price."],
    ["Buyers pay by COD or bank transfer only", "Nothing in the product ever touches buyer money."],
    ["Unpaid bank orders expire after 24 hours", "Keeps stock honest."],
    ["Stock drops when an order is placed, returns on cancellation", "What the code does now; merchants edit stock for sales made elsewhere."],
    ["Prohibited-goods and opt-in tick boxes at sign-up", "Meta's rules; enforced by suspension, not by reading every catalog."],
], [70 * mm, W - 70 * mm]))
story.append(CondPageBreak(90 * mm))

# ---------- Owner ----------
story.append(P("7. What only the owner can do", "h1"))
story.append(P("Everything here is on Track A. Nothing on Track B needs it, but Meta's clock does not "
               "start until it exists."))
story.append(table(["Item", "Why Meta needs it"], [
    ["Company registration certificate and FBR NTN certificate (clear scans, all four corners visible)", "The two documents Meta accepts to prove the name and address."],
    ["The legal name copied letter for letter from the certificate", "\"(Pvt) Ltd\" and \"(Private) Limited\" count as different names to a reviewer."],
    ["The full registered street address", "\"Lahore, Pakistan\" is a city, not an address."],
    ["A utility bill or bank statement showing the business phone number", "Proves the phone number."],
    ["Gemini billing switched on in Google Cloud", "The free tier learns from buyer data, which breaks WhatsApp's rules. It also allows only 20 requests a day."],
    ["A dedicated SIM that has never been used on WhatsApp", "Becomes our own official number."],
    ["A card on the Meta business account, and two-step login on the Meta account", "Meta requires both."],
    ["Later: submit business verification (A3), accept the Tech Provider terms (A5), click submit on App Review (A6), and choose the 3 to 5 pilot shops", "These need the account holder."],
], [85 * mm, W - 85 * mm]))
story.append(Spacer(1, 10))
story.append(box("What was dropped from the old plan", [
    "Seven different numbering systems for the same work. This plan has 7 Meta steps and 7 milestones.",
    "Meta's review scheduled after weeks of internal rework. It is now sent at week 4.",
    "Big engineering projects before launch (message queues, key rotation, deletion pipelines, "
    "restore drills). They come when there is load to justify them.",
    "Facebook login for the portal. See the decisions table.",
    "An estimate of 37 to 64 working days. It was about half of the truth; this plan is in weeks.",
], bg=SURFACE, title_color=TEAL))

# ---------- Glossary ----------
story.append(CondPageBreak(120 * mm))
story.append(P("Glossary", "h1"))
story.append(table(["Term", "Plain meaning"], [
    ["Meta", "The company that owns WhatsApp and Facebook."],
    ["Tech Provider", "Meta's name for a company like us that connects other businesses to WhatsApp through its own software."],
    ["Business verification", "Meta checking that Nubrix Technologies is a real registered company, using documents."],
    ["App Review", "Meta checking what our software does, using videos, before letting it work for any business."],
    ["Advanced access", "Permission to use WhatsApp's tools for other businesses, not only our own."],
    ["Embedded Signup / \"Connect WhatsApp\"", "Meta's pop-up window where a merchant links their WhatsApp Business number to our software with a few clicks."],
    ["Tester", "A person Meta lets us add to our app so they can use it before approval."],
    ["Key / token", "A long secret code that lets our software send messages as a merchant. One per shop, stored encrypted."],
    ["Template / pre-approved message", "A message Meta has approved in advance. The only kind that can be sent to a buyer who last wrote more than 24 hours ago."],
    ["24-hour window", "After a buyer messages, the bot may reply freely for 24 hours. After that, only templates."],
    ["Webhook", "The way WhatsApp delivers incoming messages to our server."],
    ["Display name", "The business name a buyer sees on WhatsApp. Meta approves it separately and it must match the real business."],
    ["Quality rating", "Meta's green / yellow / red score for a number, based on blocks and reports. Red means restrictions."],
    ["Pilot", "The first 3 to 5 real shops using the product with real customers before we open it to everyone."],
], [55 * mm, W - 55 * mm]))

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                        topMargin=18 * mm, bottomMargin=22 * mm,
                        title="Sahulatcart - Market-ready plan", author="Sahulatcart",
                        subject="What to build, in what order, and what changes on Meta approval day")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT)
