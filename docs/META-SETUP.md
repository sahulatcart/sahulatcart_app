# Meta / WhatsApp Cloud API — Setup Guide (Path C, test number)

What **you** do in Meta's console to give us a working test WhatsApp number. No business
verification needed for this (Path C). ~20–30 min. You'll end with 5 values I plug into the backend.

> You need: a **Facebook account**, and a **spare phone number** that is **NOT currently on WhatsApp
> or WhatsApp Business** (Meta gives you a free test number too — see step 4; a real number is only
> needed to message beyond 5 test recipients).

## The 5 values I need at the end
| Value | Where it comes from |
|---|---|
| `META_APP_ID` | App dashboard → top |
| `META_APP_SECRET` | App → Settings → Basic → App Secret (click Show) |
| `META_WEBHOOK_VERIFY_TOKEN` | **You invent this** — any random string (e.g. a password). Give me the same one. |
| `META_SYSTEM_USER_TOKEN` | Access token (step 5) |
| `META_DEFAULT_PHONE_NUMBER_ID` | WhatsApp → API Setup → "Phone number ID" |

## Steps

### 1. Meta Business + Developer account
1. Go to **business.facebook.com** → create a **Business Portfolio** if you don't have one (name it e.g. "Sahulatcart").
2. Go to **developers.facebook.com** → log in → **My Apps** → **Create App**.

### 2. Create the app
1. Use case: choose **"Other"** → app type **"Business"** → Next.
2. Name it (e.g. `sahulatcart-dev`), pick your Business Portfolio → **Create App**.
3. On the app dashboard, find **WhatsApp** → click **Set up**. This adds the WhatsApp product and
   auto-creates a **test WhatsApp Business Account (WABA)** and a **free test number**.

### 3. Grab App ID + App Secret
- **App ID**: shown at the top of the dashboard → that's `META_APP_ID`.
- **App Secret**: left sidebar → **App settings → Basic → App Secret → Show** → that's `META_APP_SECRET`.

### 4. The test phone number
- Left sidebar → **WhatsApp → API Setup**.
- You'll see a **"From" test number** with a **Phone number ID** → that's `META_DEFAULT_PHONE_NUMBER_ID`.
- Under **"To"**, add **your own personal WhatsApp number** as a test recipient (Meta lets you message up
  to 5 test recipients without verification — perfect for our pilot round-trip).

### 5. Access token
For a quick start, the **temporary token** on the API Setup page works (valid ~24h) — copy it as
`META_SYSTEM_USER_TOKEN` to test today. For something that doesn't expire, create a **System User token**:
1. **business.facebook.com → Business Settings → Users → System Users → Add** → name it, role **Admin**.
2. **Add Assets** → assign your app (full control).
3. **Generate New Token** → select the app → permissions **`whatsapp_business_messaging`** +
   **`whatsapp_business_management`** → generate → copy it. That's a long-lived `META_SYSTEM_USER_TOKEN`.

### 6. Webhook (I do this with you)
- I'll deploy the backend and give you its URL, e.g. `https://<your-app>.up.railway.app/api/v1/webhook/whatsapp`.
- In the app: **WhatsApp → Configuration → Edit webhook**:
  - **Callback URL** = that URL
  - **Verify token** = the `META_WEBHOOK_VERIFY_TOKEN` string you invented (give me the same value)
  - Click **Verify and Save** (Meta calls our endpoint; it's already built to answer).
  - **Subscribe** to the **`messages`** field.

### 7. Send me the 5 values
Paste the 5 values (App ID, App Secret, Verify Token, System User Token, Phone Number ID). I'll put them
in the backend env (never committed) and we do the live round-trip: you WhatsApp the test number → the
bot replies.

> ⚠️ Treat the App Secret + token like passwords. Since you'll paste them in chat, plan to rotate the
> token after the pilot. Long-lived System-User tokens can be regenerated anytime.
