# DNS rollback — sahulatcart.com

Snapshot taken **22 September 2026**, before repointing the domain from Vercel to Railway.
If anything goes wrong, restore exactly these records at Namecheap and the old site returns.

Registrar / DNS: **Namecheap** (`dns1.registrar-servers.com`, `dns2.registrar-servers.com`)

## Records as they were (Vercel)

| Host | Type | Value |
| --- | --- | --- |
| `@` | A | `216.198.79.1` |
| `www` | CNAME | `1f83ec8a952704d4.vercel-dns-017.com.` |

## Do NOT touch these — email breaks if you do

| Host | Type | Value | Priority |
| --- | --- | --- | --- |
| `@` | MX | `eforward1.registrar-servers.com.` | 10 |
| `@` | MX | `eforward2.registrar-servers.com.` | 10 |
| `@` | MX | `eforward3.registrar-servers.com.` | 10 |
| `@` | MX | `eforward4.registrar-servers.com.` | 15 |
| `@` | MX | `eforward5.registrar-servers.com.` | 20 |
| `@` | TXT | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | — |

Only the A and CNAME rows above change. The MX and TXT rows stay exactly as they are.

## Note

The Vercel deployment itself is not deleted by any of this. Repointing DNS only changes where
the domain sends visitors. The Vercel project stays in the account and can be restored by
putting the two records back.
