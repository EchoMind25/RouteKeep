# Export format, version 1 (FR-EXP-03)

Settings, Export builds one ZIP. Everything the business has in the app is in it,
in formats any spreadsheet or database can read, and `customers-import.csv`
re-imports into this app (or starts a new account) with no column matching.

| Path | What it holds |
| --- | --- |
| `manifest.json` | `format`, `formatVersion` ("1"), business name, `createdAt` (UTC), the business time zone, the list of files, and any table that could not be read (`unreadableTables`, normally empty) |
| `README.txt` | The same layout in plain words |
| `tables/<table>.csv` and `.json` | Every row of every table the business owns, all columns. One file pair per table |
| `customers-import.csv` | One row per customer: `id, display_name, first_name, last_name, company_name, email, phone, alt_phone, service_address_line1, service_address_line2, service_city, service_region, service_postal_code, access_notes, notes, plan_name, plan_price, next_service, balance, status` |
| `records/<YYYY-MM>.pdf` | Every pesticide application record for the month (current versions; amendments shown as amended), with the business name and license on each page. A month over 200 records is split into `records/<YYYY-MM>-partNN-of-MM.pdf`, 200 records each, in date order; every record is also in `tables/applications.csv` |
| `attachments/...` | Photos, signatures and documents, by their stored path without the tenant prefix |

Conventions:

- Money is integer cents in `tables/` (12900 is $129.00) and dollars with two
  decimals in `customers-import.csv`.
- Instants (`*_at`) are UTC in ISO 8601. Things a person scheduled keep their
  local date, local time and IANA zone columns as stored (ENG-05).
- Map points (`location` columns) are split into `location_lat` and `location_lng`.
- JSON columns are written as JSON text inside the CSV cells.
- CSV is RFC 4180 with a UTF-8 byte order mark and CRLF line ends. Text that
  starts with `=`, `+`, `-` or `@` is prefixed with an apostrophe so spreadsheet
  programs do not run it as a formula; our import removes it again.
- Phone numbers are E.164 (`+18015550142`).

Changes to this format bump `formatVersion`; the import keeps reading older versions.
