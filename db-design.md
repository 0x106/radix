# The database question

_A plain-language note on what this store needs to be, based on what the example apps actually do._

---

## What we actually have

The current store is a keyed in-memory map (collection → id → row) with synchronous reads and writes, an equality-only `where` filter, one-field ordering, and IndexedDB persistence underneath. The example apps were written against this surface on purpose — the goal was to find the edges, not to have a complete solution upfront.

---

## What the three new examples revealed

**Admin dashboard** is the first app with two collections (`users` and `audit`) and bulk mutations. Each write in the bulk loop fires its own subscriber notification — three "select all, suspend" presses means 24 separate React re-renders. That's fine at this scale but points at a real need: **batched/transactional writes**. Not for correctness (single-user, local-only — there's nothing to roll back _against_), but to avoid thrashing the UI. A `db.batch(fn)` that defers notification until the whole function completes would cover this, and it's a small addition to the current model.

The admin app also does free-text search and a status count in JavaScript rather than the store. Both are one-liners on the client and the dataset will never be large enough to matter. No need to add them to the store.

**Finance dashboard** has no writes beyond the seed, just aggregations (sum, group-by). The store returns all rows in a collection and the app folds them with `reduce`. This is exactly the right split for our constraints: we're never going to have a dataset that makes a full-collection scan expensive, so pushing aggregation into the store would add query language complexity for zero practical benefit. The current model handles analytics fine.

**Shop** is the most interesting case. It has three collections that reference each other by id (products, orders, orderItems), and the admin view reassembles an order by querying `orderItems` where `orderId` matches, then calling `db.get` for each product. That's a hand-rolled join, and it works, but it does two things the store currently can't help with:

1. **The join itself.** Fetching order lines means one `db.query` on `orderItems` filtered by `orderId`, then N `db.get` calls for products. This is readable code but it's also the thing a `db.query('orderItems', { include: { product: 'productId' } })` call would collapse into one operation. Whether that's worth adding depends on how frequently apps need it.

2. **Multi-collection writes without atomicity.** Placing an order writes an order row, N orderItem rows, and decrements N product stock values as separate calls. Each fires its own subscriber notification. If one call threw mid-way, the store would be inconsistent. In practice this won't happen (it's local, synchronous, in-memory — nothing can "fail" between two `db.create` calls), but the pattern is still fragile to reason about. A `db.batch` wrapper would also clean this up.

---

## The GraphQL question

The short answer is: not yet, and probably not in this form.

GraphQL is a query language designed to let a client specify exactly which fields and relations it wants, so a server can satisfy it in one round trip. The problem it solves is network: you have a client and a server and you want to avoid N+1 HTTP requests. We don't have a network. Our "server" is a synchronous in-memory object in the same JavaScript context as the component. N+1 `db.get` calls cost nothing.

What GraphQL _also_ provides, and what is actually relevant here, is a **typed, navigable schema** and a **declarative relation-traversal syntax** (`{ order { items { product { name } } } }`). That's genuinely useful if apps are going to be authored by a model and the model needs to reason about data shapes declaratively. But taking on GraphQL's full syntax and execution model is a large surface with a lot of edge cases.

A more constrained thing that would buy most of the benefit: an optional `include` parameter on `db.query` that resolves foreign key fields inline. Something like:

```js
db.query("orderItems", {
  where: { orderId: order.id },
  include: { product: { from: "products", on: "productId" } },
});
// returns [{ id, orderId, qty, product: { id, name, price } }, ...]
```

That's a small addition to the current query contract, it covers the join case the shop app showed, and it's something a model can reason about clearly. It's not GraphQL, but it handles the realistic use case without the schema-definition overhead.

---

## What the store does NOT need

Given the constraints (local-only, single user, small datasets, model-authored apps, throwaway prototypes):

- **Indexes.** Full-collection scans are instant at this data size.
- **Transactions / rollback.** Atomicity isn't needed between JS operations that can't fail mid-way. Batched notification (see above) is the real need.
- **Range queries in the store.** Every app that needs a date range or price range just filters in JS after a full query. The code is obvious and the cost is zero.
- **Aggregation in the store.** Same — do it in JS. The finance app's entire analytics view is four lines of `reduce`.
- **A schema definition language.** The store is schema-free by design; the prototype defines its shape implicitly by the rows it creates. A model can read that shape from the seed function.

---

## The realistic near-term additions

In priority order, based on what the five example apps actually ran into:

1. **`db.batch(fn)`** — run a function of mutations, defer all subscriber notifications until the end. Covers bulk actions (admin) and multi-collection writes (shop) without touching the query surface.

2. **`include` on `db.query`** — optional inline relation resolution for the join case. One extra key in the query args, one extra resolution step in the implementation. Low complexity, high payoff for relational apps.

3. **Nothing else right now.** The current surface is sufficient for every app in the 40-example set. The two additions above would cover the gaps the examples found. Everything else (range queries, aggregation, GraphQL, schema language) would add complexity that isn't earning its keep yet.

---

## What to watch for as more apps are built

The cron and chat apps didn't stress the store much — they use it as a simple log/queue. The apps that will most likely reveal new needs are the ones with deeper relational models (booking system, food delivery with drivers/restaurants/orders) and the ones with larger seeded datasets. If `include` keeps being insufficient and hand-rolled joins keep proliferating, that's the signal to think about a proper relation layer. But there's no evidence for that yet.
