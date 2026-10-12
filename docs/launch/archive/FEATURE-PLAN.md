# Sahulatcart — features needed for market readiness

**Updated: 6 October 2026.** A feature-only version of the [detailed launch roadmap](README.md).

The [implementation plan](IMPLEMENTATION-PLAN.md) maps every feature below to ordered work packages and code changes.

**Build** = the required capability is missing. **Finish** = relevant code exists; complete the missing behavior and make the whole feature work reliably. These labels describe the reviewed repository, not verified live readiness.

The target experience: a merchant signs up, connects WhatsApp, sets up their shop and starts receiving orders. The merchant verifies bank payments, fulfills orders and handles exceptional cases.

## 1. Merchant account and onboarding

| # | Feature | What the merchant must be able to do | Work |
|---|---|---|---|
| F01 | Facebook signup and login | Create an account and sign back in through Facebook. | Build |
| F02 | Automatic merchant account creation | Receive their own shop and dashboard immediately after signup, without duplicate accounts on retry. | Build |
| F03 | Returning access and account recovery | Return to the same shop, sign out safely and recover access through an authorized process. | Finish |
| F04 | Saved onboarding progress | Set up business details, payment methods and selling preferences, then resume later from the same step. | Finish |

## 2. WhatsApp connection

| # | Feature | What the product must do | Work |
|---|---|---|---|
| F05 | Connect the merchant's WhatsApp | Guide the owner through Meta signup to connect an eligible business account and number, with clear guidance for existing numbers. | Build |
| F06 | Secure access for each merchant | Use each shop's own WhatsApp authorization automatically, without asking owners to copy tokens. | Build |
| F07 | Connection status, reconnect and disconnect | Show whether WhatsApp works, explain connection problems and let the owner reconnect or stop the connection. | Build |
| F08 | Readiness-based activation | Enable the bot only when WhatsApp, products, delivery and payment settings are ready; explain anything missing. | Finish |

## 3. Shop and catalog setup

| # | Feature | What the merchant must be able to do | Work |
|---|---|---|---|
| F09 | Complete product catalog | Add/edit/archive products, prices, photos and discount limits; import a CSV with clear errors and safe updates. | Finish |
| F10 | Stock and sellable variants | Manage available quantities for actual SKUs, including size/color combinations where offered, and prevent selling unavailable options. | Finish |
| F11 | Delivery areas and charges | Set supported cities/areas and delivery fees so the bot quotes the correct full total. | Finish |
| F12 | Shop knowledge and policies | Set FAQs, business hours, payment information, delivery expectations and return/exchange policies used in replies. | Finish |

## 4. Customer sales conversation

| # | Feature | What the customer must experience | Work |
|---|---|---|---|
| F13 | Useful local-language replies | Receive accurate product/shop answers in Roman Urdu, Urdu and English, with clarification when information is missing. | Finish |
| F14 | Controlled negotiation | Bargain within the merchant's rules; the bot never agrees below the permitted floor or invents a discount. | Finish |
| F15 | Complete cart and checkout | Select products/variants/quantities, correct mistakes, enter delivery details, choose payment and explicitly confirm the final total. | Finish |
| F16 | Clear owner handoff | Ask for the merchant or get help when the bot cannot answer, with the conversation preserved. | Finish |

## 5. Orders, stock and payments

| # | Feature | Required behavior | Work |
|---|---|---|---|
| F17 | Reliable order placement and stock reduction | Place one order and reduce stock once; concurrent buyers, duplicate messages and failed stock updates cannot produce incorrect confirmations. | Finish |
| F18 | Order confirmation and receipt | Give the buyer and owner an accurate order reference, item summary, total and payment status, with a readable receipt. | Finish |
| F19 | Cash on delivery | Confirm COD orders while keeping the amount due separate from payment actually collected. | Finish |
| F20 | Bank-payment screenshot review | Collect evidence privately; the owner chooses Received/Not received; the buyer receives the resulting update through an allowed messaging path, including delayed reviews. | Finish |
| F21 | Cancellation and unpaid-order expiry | Handle cancellations and expired unpaid orders under the merchant's policy, restoring stock once when appropriate. | Finish |
| F22 | Return and failed-delivery exceptions | Record the issue, let the owner decide the outcome and restore stock only when the goods are available for sale again. | Build |

F22 is a basic owner-managed exception feature. Fulfillment and any actual refunds remain the merchant's responsibility.

## 6. Merchant's daily workspace

| # | Feature | What the merchant must be able to do | Work |
|---|---|---|---|
| F23 | Orders and conversation workspace | Find orders/chats, inspect details, review payments, reply to buyers, take over a conversation and pause/resume the bot. | Finish |
| F24 | Actionable notifications | Notice new orders, pending payment reviews, handoff requests and connection/message failures, with a direct route to the needed action. | Finish |
| F25 | Usable mobile dashboard | Complete onboarding and daily tasks from a phone, with clear loading, saved, failed and disconnected states. | Finish |
| F26 | Accurate sales overview | See inquiries, placed orders, verified payments, COD amounts, cancellations and discounts without counting drafts or retries as sales. | Finish |

## 7. Protection and reliability across all features

These capabilities apply throughout the build; they are required for market readiness alongside the visible screens.

| # | Feature | Required behavior | Work |
|---|---|---|---|
| F27 | Secure merchant accounts and private data | Keep each shop's customers, orders, payment evidence and credentials separate; allow sensitive actions only to authorized users. | Finish |
| F28 | Message and order recovery | Preserve accepted messages, recover interrupted work, show failed deliveries and prevent retries from repeating sales or payment actions. | Finish |
| F29 | Merchant data controls | Let owners request their data/export and account deletion, disconnect the service and understand the retention of their records. | Build |

## 8. Features required before charging merchants

These can follow a free pilot, but must be ready before the corresponding paid offer is sold.

| # | Feature | What the merchant must be able to do | Work |
|---|---|---|---|
| F30 | Plan and subscription management | See their trial/plan, fee, renewal date and subscription status; renew or cancel through a clear process. Manual subscription invoicing can support the first version. | Build |
| F31 | Usage visibility and limits | Understand included usage, see warnings before limits and know how service behaves when an allowance is reached. | Build |

## Feature delivery order

1. Make order/stock correctness and message recovery safe: **F17, F28**, with **F27** applied throughout.
2. Complete merchant accounts and WhatsApp activation: **F01–F08**.
3. Complete shop setup and the buyer's sales journey: **F09–F16**.
4. Complete payments, receipts and order exceptions: **F18–F22**.
5. Finish the daily merchant workspace and data controls: **F23–F26, F29**.
6. Add subscription and usage features before paid launch: **F30–F31**.

The first public product needs **F01–F29** working together. A paid release also needs **F30–F31**. This feature plan complements the detailed roadmap's testing and launch requirements.
