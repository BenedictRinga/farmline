// src/time.js — THE UNIFIED FARM TIME SERVICE.
//
// 2026-10-25 (the founder: "None of my apps use UTC or other arbitrary
// standards, each frontend and backend favoring a unified time service. So
// please find the applicable one in Farmline, if already there, or take the
// cue from Zyppar and build one and adapt all time issues to it. It is the
// safe approach to reducing scheduling bugs.")
//
// Zyppar's src/_helpers/bdate.ts is the model. Farmline's calendar is EAST
// AFRICA TIME (Africa/Nairobi) — the market this app serves. Before this
// service the code scattered three incompatible clocks:
//   • `new Date().toISOString().slice(0, 10)` — a UTC day key that flips at
//     03:00 East Africa time (so "today" was wrong for three hours a night);
//   • a manual `+ 3 * 3600_000` hack for the EAT day/month keys;
//   • one inline `Intl.DateTimeFormat(..., 'Africa/Nairobi')` for the ZU day.
// This module replaces all three with ONE source of truth.
//
// RULES (uniform — apply EVERYWHERE, not per-feature):
// 1. DAY KEYS / BUCKETS / CALENDAR LABELS -> farmDay() / farmDayOffset() /
//    farmMonth(); Mongo day-bucketing MUST carry `timezone: FARM_TZ`.
// 2. INSTANTS (a moment in time, stored or transported) -> new Date() /
//    .toISOString() are fine; the FRONTEND renders them in the viewer's device
//    timezone (never the server's).
// 3. Only label PRODUCTION goes through this module. Label ARITHMETIC on an
//    existing YYYY-MM-DD string (adding a day to the string) is tz-exact and
//    does not need the module.
//
// TZ SOURCE: FARMLINE_TZ env (IANA name), read through config.js — the one
// place Farmline reads environment. Fallback 'Africa/Nairobi'.

const config = require('./config');

const FARM_TZ = config.timezone;

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: FARM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const monthFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: FARM_TZ,
    year: 'numeric',
    month: '2-digit',
});

/** The farm-calendar day key (YYYY-MM-DD) for an instant, in FARM_TZ. */
function farmDay(t = new Date()) {
    const d = t instanceof Date ? t : new Date(t);
    if (Number.isNaN(d.getTime())) return farmDay(new Date());
    return dayFormatter.format(d); // en-CA → YYYY-MM-DD
}

/** The farm-calendar day key N days from now (negative = past). */
function farmDayOffset(n) {
    return farmDay(new Date(Date.now() + n * 86400000));
}

/** The farm-calendar month key (YYYY-MM) for an instant, in FARM_TZ. */
function farmMonth(t = new Date()) {
    const d = t instanceof Date ? t : new Date(t);
    if (Number.isNaN(d.getTime())) return farmMonth(new Date());
    return monthFormatter.format(d); // en-CA → YYYY-MM
}

/** The Date instant of FARM_TZ midnight that STARTS the given farm day
 *  (YYYY-MM-DD). General, not a magic offset: it reads what the label's
 *  "00:00 UTC" instant says on the FARM_TZ wall clock, then steps back that
 *  many hours. Exact for Africa/Nairobi (no DST); a hypothetical DST override
 *  is off by at most an hour on the two transition days — the honest price of
 *  a timezone-general service. */
function farmMidnight(day = farmDay()) {
    const asUTC = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(asUTC.getTime())) return farmMidnight(farmDay());
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: FARM_TZ,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(asUTC);
    const get = (type) => Number((parts.find((p) => p.type === type) || {}).value || 0);
    const offsetMs = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000;
    return new Date(asUTC.getTime() - offsetMs);
}

module.exports = { FARM_TZ, farmDay, farmDayOffset, farmMonth, farmMidnight };
