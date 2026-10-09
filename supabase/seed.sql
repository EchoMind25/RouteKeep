-- Demo business for local development and the 500-stop performance checks.
-- Everything here is fictional: people, businesses, license numbers and
-- addresses (real city names, invented house numbers). Product EPA numbers use
-- company number 0, which EPA never assigns, so none can be mistaken for a
-- real label. Applied by `supabase db reset` and scripts/db/local.sh reset;
-- never by `supabase db push`, so it cannot reach production.
--
-- Sign in locally (AUTH_MODE=local) as owner@demo.routeverde.test,
-- office@demo.routeverde.test or tech.dez@demo.routeverde.test.

select setseed(0.42);

-- Logins. Columns beyond id/email keep the Supabase CLI stack's auth server happy.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('demo-only-password', extensions.gen_salt('bf')), now(), '', '', '', '',
       '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'owner@demo.routeverde.test'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'office@demo.routeverde.test'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'dispatch@demo.routeverde.test'),
  ('d0000000-0000-4000-8000-000000000011'::uuid, 'tech.dez@demo.routeverde.test'),
  ('d0000000-0000-4000-8000-000000000012'::uuid, 'tech.anika@demo.routeverde.test'),
  ('d0000000-0000-4000-8000-000000000013'::uuid, 'tech.ruben@demo.routeverde.test'),
  ('d0000000-0000-4000-8000-000000000014'::uuid, 'tech.hollis@demo.routeverde.test')
) as u(id, email);

insert into public.tenants (id, name, timezone, state, business_license_no, plan, created_by)
values ('7e000000-0000-4000-8000-000000000001', 'Timpanogos Pest & Lawn (demo)', 'America/Denver', 'UT', 'DEMO-UT-BUS-4471', 'pro',
        'd0000000-0000-4000-8000-000000000001');

-- Routes start and end at the office (fictional address; the point is in Orem).
insert into public.offices (tenant_id, name, address_line1, city, region, postal_code, phone, is_primary, location)
values ('7e000000-0000-4000-8000-000000000001', 'Timpanogos Pest & Lawn (demo)', '1800 N Demo Industrial Way', 'Orem', 'UT', '84057', '+18015550100', true,
        extensions.st_setsrid(extensions.st_makepoint(-111.7120, 40.3260), 4326)::extensions.geography);

insert into public.memberships (tenant_id, user_id, role, email, display_name) values
  ('7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'owner', 'owner@demo.routeverde.test', 'Marisol Quintero'),
  ('7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'office', 'office@demo.routeverde.test', 'Teodoro Vance'),
  ('7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'dispatcher', 'dispatch@demo.routeverde.test', 'Priya Halvorsen'),
  ('7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000011', 'technician', 'tech.dez@demo.routeverde.test', 'Dez Whitlock'),
  ('7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000012', 'technician', 'tech.anika@demo.routeverde.test', 'Anika Sorensen'),
  ('7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000013', 'technician', 'tech.ruben@demo.routeverde.test', 'Ruben Okafor'),
  ('7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000014', 'technician', 'tech.hollis@demo.routeverde.test', 'Hollis Baptiste');

insert into public.technicians (id, tenant_id, user_id, display_name, phone, applicator_license_no, license_expiry, categories, color_index) values
  ('7ec00000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000011', 'Dez Whitlock', '+18015550111', 'DEMO-APP-1031', current_date + 420, '{structural,ornamental}', 0),
  ('7ec00000-0000-4000-8000-000000000002', '7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000012', 'Anika Sorensen', '+18015550112', 'DEMO-APP-1187', current_date + 35, '{structural}', 1),
  ('7ec00000-0000-4000-8000-000000000003', '7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000013', 'Ruben Okafor', '+18015550113', 'DEMO-APP-1240', current_date + 610, '{structural,turf}', 2),
  ('7ec00000-0000-4000-8000-000000000004', '7e000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000014', 'Hollis Baptiste', '+18015550114', 'DEMO-APP-1302', current_date + 300, '{turf,ornamental}', 3);

insert into public.products (tenant_id, name, kind, epa_reg_no, signal_word, restricted_use, active_ingredients,
                             default_amount_unit, default_mix_rate, default_mix_unit) values
  ('7e000000-0000-4000-8000-000000000001', 'Demo Perimeter Concentrate (sample data)', 'pesticide', '0-101', 'caution', false, 'Bifenthrin 7.9%', 'gal', 0.5, 'fl_oz_per_gal'),
  ('7e000000-0000-4000-8000-000000000001', 'Demo Crack and Crevice Dust (sample data)', 'pesticide', '0-102', 'caution', false, 'Deltamethrin 0.05%', 'oz', null, null),
  ('7e000000-0000-4000-8000-000000000001', 'Demo Ant Gel Bait (sample data)', 'pesticide', '0-103', 'caution', false, 'Indoxacarb 0.05%', 'g', null, null),
  ('7e000000-0000-4000-8000-000000000001', 'Demo Broadleaf Weed Control (sample data)', 'pesticide', '0-104', 'warning', false, '2,4-D, dicamba, mecoprop', 'gal', 1.5, 'fl_oz_per_1000_sq_ft'),
  ('7e000000-0000-4000-8000-000000000001', 'Demo Rodent Bait Blocks (sample data)', 'pesticide', '0-105', 'caution', false, 'Bromadiolone 0.005%', 'each', null, null),
  ('7e000000-0000-4000-8000-000000000001', 'Demo Lawn Fertilizer 24-0-6 (sample data)', 'fertilizer', null, null, false, 'Nitrogen 24%, potash 6%', 'lb', 4, 'lb_per_1000_sq_ft'),
  ('7e000000-0000-4000-8000-000000000001', 'Demo Botanical Mosquito Spray (sample data)', 'minimum_risk', null, null, false, 'Cedarwood oil, geraniol', 'gal', 2, 'fl_oz_per_gal');

insert into public.service_plans (id, tenant_id, service_type_id, name, price_cents, initial_price_cents, rrule, billing_mode, default_duration_min)
select p.id, '7e000000-0000-4000-8000-000000000001', st.id, p.name, p.price, p.initial, p.rrule, p.billing, p.duration
from (values
  ('7ea00000-0000-4000-8000-000000000001'::uuid, 'pest', 'Quarterly home protection', 12900, 19900, 'FREQ=MONTHLY;INTERVAL=3', 'per_service', 30),
  ('7ea00000-0000-4000-8000-000000000002'::uuid, 'pest', 'Every other month', 8900, 17900, 'FREQ=MONTHLY;INTERVAL=2', 'per_service', 30),
  ('7ea00000-0000-4000-8000-000000000003'::uuid, 'pest', 'Monthly commercial', 7500, null, 'FREQ=MONTHLY', 'monthly', 45),
  ('7ea00000-0000-4000-8000-000000000004'::uuid, 'lawn', 'Lawn program, 6 rounds', 5900, null, 'FREQ=YEARLY;BYMONTH=3,4,5,7,9,10', 'per_service', 25),
  ('7ea00000-0000-4000-8000-000000000005'::uuid, 'mosquito', 'Mosquito season', 6900, null, 'FREQ=WEEKLY;INTERVAL=3;BYMONTH=5,6,7,8,9', 'per_service', 20)
) as p(id, category, name, price, initial, rrule, billing, duration)
join public.service_types st on st.tenant_id = '7e000000-0000-4000-8000-000000000001' and st.category = p.category;

-- 3,000 customers (the PRD's import fixture size) over Utah County and south Salt Lake County.
create temp table demo_city (idx int, city text, zip text, lat float8, lng float8, tech int);
insert into demo_city values
  (0, 'Provo', '84604', 40.2550, -111.6550, 1), (1, 'Orem', '84058', 40.2850, -111.6950, 1),
  (2, 'Springville', '84663', 40.1650, -111.6100, 1), (3, 'Lehi', '84043', 40.3900, -111.8500, 2),
  (4, 'American Fork', '84003', 40.3770, -111.7960, 2), (5, 'Pleasant Grove', '84062', 40.3640, -111.7390, 2),
  (6, 'Saratoga Springs', '84045', 40.3490, -111.9050, 4), (7, 'Draper', '84020', 40.5250, -111.8640, 3),
  (8, 'Sandy', '84092', 40.5650, -111.8390, 3), (9, 'Spanish Fork', '84660', 40.1150, -111.6550, 4);

create temp table demo_names as
select
  array['Marisol','Teodoro','Priya','Dez','Anika','Ruben','Hollis','Kenji','Ingrid','Malik','Saoirse','Tomas','Yesenia','Bram','Odalys','Callum','Nadia','Ezra','Lupe','Soren',
        'Imani','Gideon','Rosalind','Arjun','Wren','Matteo','Delphine','Kofi','Elsbeth','Rafael','Juniper','Tobiah','Mireille','Ansel','Kalani','Viggo','Thandiwe','Leopold','Esperanza','Bodhi'] as firsts,
  array['Quintero','Vance','Halvorsen','Whitlock','Sorensen','Okafor','Baptiste','Nakamura','Lindqvist','Abernathy','Fairbanks','Cardenas','Oyelaran','Thorsby','Pellegrini','McAllister','Haddad','Rasmussen','Villalobos','Kettleman',
        'Achterberg','Bjornstad','Castellanos','Draycott','Esposito','Fonoti','Gundersen','Hakimi','Iversen','Jaramillo','Kowalczyk','Larrabee','Montoya','Nygaard','Ostrander','Pulsipher','Quarshie','Ridgeway','Stohl','Tuilagi'] as lasts,
  array['N','S','E','W'] as dirs,
  array['Canyon View Dr','Sage Hill Ln','Orchard Dr','Bonneville Way','Cottonwood Ln','Timp Vista Rd','Maple Ridge Dr','Hidden Hollow Ln','Foothill Cir','Pioneer Ln'] as named;

insert into public.customers (id, tenant_id, kind, first_name, last_name, company_name, display_name, email, phone,
                              sms_consent_at, sms_consent_source, email_opt_in, email_opt_in_at, notes)
select
  ('c0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '7e000000-0000-4000-8000-000000000001',
  case when i % 24 = 0 then 'commercial' else 'residential' end,
  n.firsts[1 + i % 40],
  n.lasts[1 + (i / 40) % 40],
  case when i % 24 = 0 then n.lasts[1 + (i / 40) % 40] || ' Family Dental (demo)' end,
  case when i % 24 = 0 then n.lasts[1 + (i / 40) % 40] || ' Family Dental (demo)'
       else n.firsts[1 + i % 40] || ' ' || n.lasts[1 + (i / 40) % 40] end,
  lower(n.firsts[1 + i % 40]) || '.' || lower(n.lasts[1 + (i / 40) % 40]) || i || '@example.com',
  -- 555-0100 to 555-0199 is reserved for fiction in every area code.
  case when i % 2 = 0 then '+1801' else '+1385' end || '55501' || lpad((i % 100)::text, 2, '0'),
  case when i % 3 = 0 then now() - (i || ' days')::interval end,
  case when i % 3 = 0 then 'demo seed' end,
  i % 5 = 0,
  case when i % 5 = 0 then now() - (i || ' days')::interval end,
  case when i % 17 = 0 then 'Prefers a call 30 minutes ahead.' end
from generate_series(1, 3000) as i, demo_names n;

insert into public.properties (id, tenant_id, customer_id, address_line1, city, region, postal_code, location,
                               geocode_confidence, geocode_source, geocoded_at, access_notes, sq_ft, lawn_area_sq_ft)
select
  ('a0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '7e000000-0000-4000-8000-000000000001',
  ('c0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  case when i % 4 = 0 then (100 + (i * 37) % 2900)::text || ' ' || n.named[1 + i % 10]
       else (100 + (i * 37) % 2900)::text || ' ' || n.dirs[1 + i % 4] || ' ' || ((1 + i % 18) * 100)::text || ' ' || n.dirs[1 + (i + 1) % 4] end,
  c.city, 'UT', c.zip,
  extensions.st_setsrid(extensions.st_makepoint(c.lng + (random() - 0.5) * 0.06, c.lat + (random() - 0.5) * 0.05), 4326)::extensions.geography,
  -- A few low-confidence pins so the "check pin" path is visible (R-BUG-05).
  case when i % 29 = 0 then 0.45 else 0.95 end,
  'demo', now(),
  case when i % 11 = 0 then 'Side gate code 4417. Friendly dog in back yard.' when i % 13 = 0 then 'Park on the street, not the driveway.' end,
  1400 + (i * 53) % 2600,
  2500 + (i * 97) % 9000
from generate_series(1, 3000) as i
join demo_city c on c.idx = i % 10
cross join demo_names n;

-- Plans: most customers on quarterly or bi-monthly pest, some with lawn or mosquito.
insert into public.subscriptions (tenant_id, customer_id, property_id, plan_id, service_type_id, status, start_date, rrule,
                                  price_cents, initial_price_cents, billing_mode, duration_min, autopay,
                                  preferred_technician_id, preferred_window_start, preferred_window_end)
select
  '7e000000-0000-4000-8000-000000000001',
  ('c0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('a0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  sp.id, sp.service_type_id, 'active',
  -- Spread anchors so visits fall on every weekday of the next 60 days.
  -- Anchors on weekdays, spread so visits land across the next 60 days.
  case when sp.rrule like 'FREQ=YEARLY%' then make_date(extract(year from current_date)::int, 3, 1 + (i % 27))
       else (select d + case extract(isodow from d) when 6 then 2 when 7 then 1 else 0 end
             from (select current_date - ((i * 11) % 91) + case when i % 40 = 0 then 95 else 0 end as d) x) end,
  sp.rrule, sp.price_cents, sp.initial_price_cents, sp.billing_mode, sp.default_duration_min,
  i % 2 = 0,
  ('7ec00000-0000-4000-8000-00000000000' || c.tech)::uuid,
  case when i % 3 = 0 then time '08:00' when i % 3 = 1 then time '12:00' end,
  case when i % 3 = 0 then time '12:00' when i % 3 = 1 then time '17:00' end
from generate_series(1, 3000) as i
join demo_city c on c.idx = i % 10
join public.service_plans sp on sp.id = case
  when i % 24 = 0 then '7ea00000-0000-4000-8000-000000000003'::uuid
  when i % 7 = 0 then '7ea00000-0000-4000-8000-000000000004'::uuid
  when i % 9 = 0 then '7ea00000-0000-4000-8000-000000000005'::uuid
  when i % 2 = 0 then '7ea00000-0000-4000-8000-000000000001'::uuid
  else '7ea00000-0000-4000-8000-000000000002'::uuid end
where i % 15 <> 0;  -- a few customers without a plan
