# Inventory, resupply and truck stock (FR-INV)

How the feature is built. The product view is in the spec the owner approved
(project file `product/usage-forecast-and-resupply-spec-2026-10-09.md`); this
file is what code must follow. Schema: `supabase/migrations/20261014100000_inventory.sql`.

## Requirements

- FR-INV-01 Per-business setting `tenants.inventory_mode` (`off`, `forecast`, `tracked`) and `resupply_weekday`. Off is the default; nothing a technician sees changes until the owner turns it on. Owner and admin change it in Settings > Inventory.
- FR-INV-02 Weekly usage per product: last full week and trailing 4, 8 and 12 week averages, from application records (current versions only), converted to product used (concentrate, see "Product used"). Visible in Reports to owner, admin and office in every mode.
- FR-INV-03 Forecast from the schedule: this week (remaining days), each of the next 3 weeks, and the rest of the calendar month, per product, with the basis ("from 42 visits"). Also per technician for truck restock.
- FR-INV-04 Vendors and what they sell (package size, price, lead time, preferred package per product).
- FR-INV-05 Resupply list and purchase orders: suggested packages per vendor with an order-by date; the owner turns it into a draft order, prints it or opens a prefilled email in their own mail app, marks it sent, then received. RouteVerde never contacts a vendor itself.
- FR-INV-06 Tracked mode: stock on hand per location (shop and one truck per technician), receiving into a location, shop-to-truck transfers, adjustments with a reason.
- FR-INV-07 Resupply-day truck check: on the business's resupply weekday each technician with a truck gets an inventory check in the technician app (works offline, syncs like a visit). Counted minus expected is shown to the office as a variance.
- FR-INV-08 Restock list per truck: what each truck needs for its technician's scheduled visits until the next resupply day, minus what is on it.
- FR-INV-09 Material spend: received orders by month and vendor; material cost per completed visit by service type (weighted average cost from receipts).
- FR-INV-10 Pest activity by area: target pests by ZIP code and week, this business's records only, with rising flags. No cross-business data.
- FR-INV-11 Per-technician outlier: usage per visit more than 1.5x or under 0.5x the business median for the same service type and product (at least 10 visits).

## Product used (never sum finished mix as stock)

`applications.total_amount` is finished mix for sprays and the product itself for granules and baits (`components/tech/application-editor.tsx`). Product taken out of stock:

- mix unit with a solution basis (pct, fl_oz_per_gal, oz_per_gal, ml_per_l, g_per_l): `productNeeded({rate, unit}, { finishedMix: {total_amount, amount_unit} })`
- mix unit with an area basis: `total_amount` in `amount_unit`
- conversion to the product's stock unit with `convert()`; a dimension mismatch (volume vs mass) or missing data returns null and the record is listed under "check units", never counted as zero.

Stock unit of a product = `products.stock_unit`, else the unit `productNeeded` returns for its default mix unit, else `default_amount_unit`.

## On hand (tracked mode)

Stored movements are only what records cannot know: `count`, `receive`, `transfer_out`/`transfer_in`, `adjust` (append-only). Usage is derived:

```
on_hand(location L, product P) =
    last count of (L, P) [or 0 at the epoch if never counted]
  + Σ receive, transfer_in, adjust, transfer_out after that count
  - Σ product used on current-version applications of P by L's technician after that count   (trucks only)
```

The shop has no technician, so its stock goes down only by transfers to trucks and adjustments. A count is a baseline; the weekly truck check keeps every sum short. Expected quantity at count time = on_hand just before it, stored in `expected_qty`.

## Forecast

```
rate(service_type S, product P) = Σ product used of P on completed visits of S in the trailing 8 weeks
                                  ÷ number of completed visits of S in that window
  fallback: < 10 visits in 8 weeks -> 26 weeks; still < 10 -> no rate (show visit count only)
forecast(P, day D) = Σ over appointments on D with status scheduled or in_progress of rate(type, P)
```

Weeks are business-local Monday to Sunday (tenant timezone, ENG-05). Unscheduled visits (no date) are reported separately, never spread.

## Resupply suggestion

For each product with a preferred vendor package:

- next order date = next vendor order weekday on or after today (any day if none); arrival = order date + lead time
- cover window = from arrival to the following order's arrival (one order cycle; 7 days if no order weekdays)
- forecast mode: need = forecast over [today, end of cover window]; packages = ceil(need / package) — shown as a shopping list the owner can tick "have enough"
- tracked mode: projected = on hand (all locations) + open order lines (sent, not received) - forecast up to arrival; need = forecast over cover window + safety_days of average daily forecast - projected; packages = ceil(max(need, 0) / package)
- order-by date = the first day projected stock would fall below safety stock, minus lead time (tracked mode only)
- vendors under `min_order_cents` are flagged, not padded.

## Privacy

All tables tenant-scoped through `app.secure_table`. Pest activity is per business only. Vendor order text contains product lines and the business's own details, never customer data. The forecast is plain arithmetic; no data leaves the business.
