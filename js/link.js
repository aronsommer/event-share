// Link format v1, see README.md.

const FIELDS = new Map([
  ["t", "title"],
  ["l", "location"],
  ["n", "note"],
  ["d", "minutes"],
]);
const START = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(?:\d\d)?Z)?$/;

const defaults = () => ({ title: "", location: "", note: "", minutes: 60 });

const escapeValue = (value) =>
  encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/%(2C|2F|3A|40)/g, decodeURIComponent);

// 20261013T120000Z, or 20261013 for all-day events.
export function stamp(date, allDay) {
  const utc = date.toISOString().replace(/[-:]|\.\d+/g, "");
  return allDay ? utc.slice(0, 8) : utc;
}

// All-day events last whole days.
export function eventEnd({ start, allDay, minutes }) {
  const length = allDay ? Math.ceil(minutes / 1440) * 1440 : minutes;
  return new Date(start.getTime() + length * 60000);
}

export function encode(events) {
  const parts = ["v=1"];
  const current = defaults();
  for (const event of events) {
    for (const [key, field] of FIELDS) {
      if (event[field] === current[field]) continue;
      current[field] = event[field];
      parts.push(`${key}=${escapeValue(String(event[field]))}`);
    }
    const start = stamp(event.start, event.allDay);
    parts.push(`s=${event.allDay ? start : `${start.slice(0, 13)}Z`}`);
  }
  return parts.join("&");
}

export function decode(fragment) {
  const params = new URLSearchParams(fragment);
  if (params.get("v") !== "1") return [];
  const events = [];
  const current = defaults();
  for (const [key, value] of params) {
    const field = FIELDS.get(key);
    const start = key === "s" && START.exec(value);
    if (start) {
      const [year, month, day, hour = 0, minute = 0] = start.slice(1);
      events.push({
        ...current,
        start: new Date(Date.UTC(year, month - 1, day, hour, minute)),
        allDay: start[4] === undefined,
      });
    } else if (field === "minutes") {
      const minutes = Number.parseInt(value, 10);
      if (minutes > 0) current.minutes = minutes;
    } else if (field) {
      current[field] = value;
    }
  }
  return events;
}
