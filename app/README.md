This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Billing (Stripe + InstantDB)

Users spend **tokens** (1 token = $0.01 of credit) as the build agent runs — every
model call is metered against `response.usage`. New accounts get a free grant
(`FREE_GRANT_TOKENS` in `src/lib/billing.ts`). Stripe is the source of truth for
payments; InstantDB holds the balance (`accounts` / `ledgerEntries` entities).

Setup:

1. Copy `.env.example` to `.env` and fill in the `STRIPE_*` values and
   `NEXT_PUBLIC_APP_URL`.
2. In the Stripe dashboard, create one-time prices for the three token packs and a
   recurring price for the subscription; put their Price IDs in the env. Token
   amounts and labels live in `src/lib/products.ts`.
3. Push the InstantDB schema + permissions so the `accounts` and `ledgerEntries`
   entities exist (`npx instant-cli@latest push`).
4. For local webhook testing:
   `stripe listen --forward-to localhost:3000/api/stripe/webhook` — it prints the
   `STRIPE_WEBHOOK_SECRET` to use.

The app builds and runs without Stripe configured; only the `/billing` actions and
metering require the keys.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
