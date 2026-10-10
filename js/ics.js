import { eventEnd, stamp } from "./link.js";

const PROPERTY = /^([\w-]+)((?:;[\w-]+=(?:"[^"]*"|[^;:]*))*):(.*)$/;
const DATE_TIME = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/;
const DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/;

const escapeText = (text) => text.replace(/[\\;,]/g, "\\$&").replace(/\r?\n/g, "\\n");

const unescapeText = (text) => text.replace(/\\(.)/g, (_, char) => (/n/i.test(char) ? "\n" : char));

const hash = (text) =>
  [...text].reduce((sum, char) => (Math.imul(sum, 31) + char.codePointAt(0)) >>> 0, 7).toString(36);

export function toIcs(events) {
  const now = stamp(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Event Share//EN", "METHOD:PUBLISH"];
  for (const event of events) {
    const start = stamp(event.start, event.allDay);
    const type = event.allDay ? ";VALUE=DATE" : "";
    lines.push(
      "BEGIN:VEVENT",
      // Stable, so calendar apps can recognise an event they already imported.
      `UID:${start}-${hash(event.title + event.location)}@event-share`,
      `DTSTAMP:${now}`,
      `DTSTART${type}:${start}`,
      `DTEND${type}:${stamp(eventEnd(event), event.allDay)}`,
      `SUMMARY:${escapeText(event.title)}`,
      `LOCATION:${escapeText(event.location)}`,
      `DESCRIPTION:${escapeText(event.note)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

// Instant of a wall-clock time in an IANA zone; local zone if it is unknown.
function zonedTime(year, month, day, hour, minute, second, timeZone) {
  let format;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch {
    return new Date(year, month - 1, day, hour, minute, second);
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = (time) => {
    const part = Object.fromEntries(
      format.formatToParts(time).map(({ type, value }) => [type, value]),
    );
    return (
      Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second) - time
    );
  };
  return new Date(wall - offset(wall - offset(wall)));
}

function parseTime({ params, value }) {
  const match = DATE_TIME.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7);
  if (hour === undefined) {
    return { start: new Date(Date.UTC(year, month - 1, day)), allDay: true };
  }
  const start = match[7]
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    : zonedTime(year, month, day, hour, minute, second, /;TZID="?([^";]+)/i.exec(params)?.[1]);
  return { start, allDay: false };
}

function durationMinutes(value = "") {
  const [, weeks = 0, days = 0, hours = 0, minutes = 0] = DURATION.exec(value) ?? [];
  return weeks * 10080 + days * 1440 + hours * 60 + Number(minutes);
}

function toEvent(props) {
  const begin = props.DTSTART && parseTime(props.DTSTART);
  if (!begin) return null;
  const end = props.DTEND && parseTime(props.DTEND);
  const minutes = end
    ? Math.round((end.start - begin.start) / 60000)
    : durationMinutes(props.DURATION?.value);
  return {
    ...begin,
    minutes: minutes > 0 ? minutes : begin.allDay ? 1440 : 60,
    title: unescapeText(props.SUMMARY?.value ?? ""),
    location: unescapeText(props.LOCATION?.value ?? ""),
    // Descriptions are left out, they would bloat the link.
    note: "",
  };
}

// Recurring events yield their first occurrence only.
export function parseIcs(text) {
  const events = [];
  let recurring = false;
  let props = null;
  let nested = 0;
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const match = PROPERTY.exec(line);
    if (!match) continue;
    const name = match[1].toUpperCase();
    if (name === "BEGIN") {
      if (props) nested++;
      else if (match[3].toUpperCase() === "VEVENT") props = {};
    } else if (name === "END") {
      if (nested) nested--;
      else if (props) {
        const event = toEvent(props);
        if (event) events.push(event);
        recurring ||= Boolean(event && props.RRULE);
        props = null;
      }
    } else if (props && !nested) {
      props[name] = { params: match[2], value: match[3] };
    }
  }
  return { events, recurring };
}
