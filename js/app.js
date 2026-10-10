import { generate } from "../vendor/lean-qr.mjs";
import { parseIcs, toIcs } from "./ics.js";
import { decode, encode, eventEnd, stamp } from "./link.js";

const DAY = 86400000;

const $ = (id) => document.getElementById(id);

const dayFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeZone: "UTC",
});
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

const formatDate = (event) =>
  event.allDay
    ? dayFormat.formatRange(event.start, new Date(eventEnd(event) - DAY))
    : dateFormat.formatRange(event.start, eventEnd(event));

const formatTime = (event) =>
  event.allDay ? "" : timeFormat.formatRange(event.start, eventEnd(event));

const query = (params) => String(new URLSearchParams(params)).replaceAll("+", "%20");

const googleUrl = (event) =>
  `https://calendar.google.com/calendar/render?${query({
    action: "TEMPLATE",
    text: event.title,
    dates: `${stamp(event.start, event.allDay)}/${stamp(eventEnd(event), event.allDay)}`,
    location: event.location,
    details: event.note,
  })}`;

// 2026-10-13T12:00:00Z, or 2026-10-13 for all-day events.
const isoTime = (date, allDay) =>
  date
    .toISOString()
    .replace(/\.\d+/, "")
    .slice(0, allDay ? 10 : undefined);

const outlookUrl = (host, event) =>
  `https://${host}/calendar/0/deeplink/compose?${query({
    path: "/calendar/action/compose",
    rru: "addevent",
    startdt: isoTime(event.start, event.allDay),
    enddt: isoTime(eventEnd(event), event.allDay),
    allday: event.allDay,
    subject: event.title,
    location: event.location,
    body: event.note,
  })}`;

const CALENDARS = [
  ["Google", googleUrl],
  ["Outlook.com", (event) => outlookUrl("outlook.live.com", event)],
  ["Microsoft 365", (event) => outlookUrl("outlook.office.com", event)],
];

// Shown greyed where a detail is empty.
const LABELS = {
  time: "No time",
  title: "No title",
  location: "No location",
  note: "No note",
};

const element = (tag, className, textContent) =>
  Object.assign(document.createElement(tag), { className, textContent });

function renderList(list, events) {
  list.replaceChildren(
    ...events.map((event) => {
      const item = document.createElement("li");
      const links = element("span", "links screen-only", "Add to:");
      links.append(
        ...CALENDARS.map(([name, url]) =>
          Object.assign(element("a", "", name), {
            href: url(event),
            target: "_blank",
            rel: "noopener",
          }),
        ),
      );
      const values = { ...event, time: formatTime(event) };
      const details = element("span", "details", "");
      details.append(
        element("span", "", formatDate(event)),
        ...Object.entries(LABELS).map(([field, label]) =>
          element("span", values[field] ? "" : "missing", values[field] || label),
        ),
      );
      item.append(details, links);
      return item;
    }),
  );
}

// The least width and height of the QR code image.
const QR_PIXELS = 2048;

let qrCode = null;

// Draws the code with a white margin given in modules.
function drawQr(canvas, margin) {
  const modules = qrCode.size + 2 * margin;
  // Whole pixels per module keep the edges sharp.
  const scale = Math.ceil(QR_PIXELS / modules);
  canvas.width = canvas.height = modules * scale;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  for (let y = 0; y < qrCode.size; y++) {
    for (let x = 0; x < qrCode.size; x++) {
      if (qrCode.get(x, y)) {
        context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
      }
    }
  }
  return canvas;
}

// A QR code needs 4 modules of margin wherever it ends up.
const qrImage = () => drawQr(document.createElement("canvas"), 4);

function renderQr(text) {
  try {
    qrCode = generate(text);
  } catch {
    // Too much data for a QR code.
    qrCode = null;
  }
  $("qr").hidden = !qrCode;
  $("qr-tools").hidden = !qrCode;
  $("too-long").hidden = Boolean(qrCode);
  if (qrCode) drawQr($("qr"), 0);
}

// Both download links share one calendar file.
function setIcsLinks() {
  URL.revokeObjectURL($("download").href);
  const url = URL.createObjectURL(
    new Blob([toIcs(events)], { type: "text/calendar;charset=utf-8" }),
  );
  $("download").href = url;
  $("receive-download").href = url;
}

// Days for an all-day event, minutes for an event with a time.
function showUnit({ time, duration }) {
  const unit = time.value ? "min" : "days";
  const label = duration.nextElementSibling;
  if (label.textContent === unit) return;
  // Each unit keeps its own number, so correcting the time does not lose the minutes.
  if (label.textContent) {
    duration.dataset[label.textContent] = duration.value;
    duration.value = duration.dataset[unit] ?? "";
  }
  label.textContent = unit;
  duration.ariaLabel = `Duration in ${unit}`;
}

function addRow(values = {}) {
  const row = $("row").content.firstElementChild.cloneNode(true);
  for (const [name, value] of Object.entries(values)) {
    // Single-line inputs would drop line breaks without a space.
    row.elements[name].value = String(value).replace(/\r?\n/g, " ");
  }
  showUnit(row.elements);
  $("rows").append(row);
}

// By the user's clock: an all-day event at the start of its day, a row without a date last.
function sortedRows() {
  const key = ({ elements: { date, time } }) => {
    const start = new Date(`${date.value}T${time.value || "00:00"}`).getTime();
    return Number.isNaN(start) ? Infinity : start;
  };
  return [...$("rows").children].toSorted((a, b) => key(a) - key(b));
}

function readRows() {
  return sortedRows()
    .map(({ elements: field }) => {
      const allDay = !field.time.value;
      const duration = Math.round(field.duration.valueAsNumber);
      return {
        // A date alone is UTC midnight, a date with a time is local.
        start: new Date(allDay ? field.date.value : `${field.date.value}T${field.time.value}`),
        allDay,
        // Without a duration it is 60, which an all-day event rounds up to one day.
        minutes: duration > 0 ? duration * (allDay ? 1440 : 1) : 60,
        title: field.title.value.trim(),
        location: field.location.value.trim(),
        note: field.note.value.trim(),
      };
    })
    .filter((event) => !Number.isNaN(event.start.getTime()));
}

function rowValues(event) {
  const offset = event.allDay ? 0 : event.start.getTimezoneOffset() * 60000;
  const local = new Date(event.start - offset).toISOString();
  const days = Math.ceil(event.minutes / 1440);
  return {
    date: local.slice(0, 10),
    time: event.allDay ? "" : local.slice(11, 16),
    // A single day needs no duration.
    duration: event.allDay ? (days > 1 ? days : "") : event.minutes,
    title: event.title,
    location: event.location,
    note: event.note,
  };
}

// The events both tabs show.
let events = [];
let urlTimer;

// The page address that holds the current events.
function currentLink() {
  const base = location.href.split("#")[0];
  return events.length ? `${base}#${encode(events)}` : base;
}

function render() {
  const none = events.length === 0;
  $("empty").hidden = !none;
  $("output").hidden = none;
  $("none").hidden = !none;
  $("actions").hidden = none;
  $("each").hidden = none;
  renderList($("list"), events);
  if (none) return;
  const link = currentLink();
  $("link").value = link;
  setIcsLinks();
  renderQr(link);
}

function update() {
  events = readRows();
  render();
  // Browsers limit how often the URL may change.
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => history.replaceState(null, "", currentLink()), 500);
}

function showTab(name) {
  for (const button of $("tabs").children) {
    button.setAttribute("aria-pressed", button.dataset.tab === name);
  }
  for (const id of ["create", "receive"]) {
    $(id).hidden = id !== name;
    $(`${id}-title`).hidden = id !== name;
  }
}

// A link with a fragment opens in the Receive tab.
function load() {
  events = decode(location.hash.slice(1));
  $("rows").replaceChildren();
  for (const event of events) addRow(rowValues(event));
  if (!events.length) addRow();
  render();
  showTab(location.hash.length > 1 ? "receive" : "create");
}

$("tabs").addEventListener("click", ({ target }) => {
  if (target.dataset.tab) showTab(target.dataset.tab);
});

$("check").addEventListener("click", () => {
  showTab("receive");
  scrollTo(0, 0);
});

$("rows").addEventListener("input", ({ target }) => {
  showUnit(target.closest(".row").elements);
  update();
});

$("rows").addEventListener("click", ({ target }) => {
  if (!target.closest(".remove")) return;
  target.closest(".row").remove();
  // The list always keeps a row.
  if (!$("rows").children.length) addRow();
  update();
});

$("sort").addEventListener("click", () => $("rows").append(...sortedRows()));

$("clear").addEventListener("click", () => {
  if (events.length && !confirm("Clear all events?")) return;
  $("rows").replaceChildren();
  $("recurring").hidden = true;
  addRow();
  update();
});

$("add-row").addEventListener("click", () => addRow());

$("import").addEventListener("click", () => $("file").click());

$("file").addEventListener("change", async ({ target }) => {
  const [file] = target.files;
  if (!file) return;
  const { events: imported, recurring } = parseIcs(await file.text());
  target.value = "";
  if (imported.length) {
    for (const row of [...$("rows").children]) {
      if (!row.elements.date.value) row.remove();
    }
  }
  for (const event of imported) addRow(rowValues(event));
  $("recurring").hidden = !recurring;
  update();
});

// Confirms a copy on the button itself.
function confirmCopy(button) {
  button.dataset.label ??= button.textContent;
  button.textContent = "Copied";
  setTimeout(() => (button.textContent = button.dataset.label), 1500);
}

$("copy").addEventListener("click", async ({ target }) => {
  $("link").select();
  await navigator.clipboard?.writeText($("link").value);
  if (navigator.clipboard) confirmCopy(target);
});

// Needs a secure page and a browser with ClipboardItem.
$("qr-copy").hidden = !(navigator.clipboard?.write && globalThis.ClipboardItem);

$("qr-copy").addEventListener("click", async ({ target }) => {
  const image = new Promise((resolve) => qrImage().toBlob(resolve));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
  confirmCopy(target);
});

$("qr-download").addEventListener("click", () => {
  Object.assign(document.createElement("a"), {
    href: qrImage().toDataURL(),
    download: "qr-code.png",
  }).click();
});

$("print").addEventListener("click", () => print());

addEventListener("hashchange", load);

const root = document.documentElement;
const systemDark = matchMedia("(prefers-color-scheme: dark)");

// A chosen theme wins over the system's.
const isDark = () =>
  root.style.colorScheme ? root.style.colorScheme === "dark" : systemDark.matches;

// The button shows the theme it switches to.
function showTheme() {
  $("theme").textContent = isDark() ? "light_mode" : "dark_mode";
}

$("theme").addEventListener("click", () => {
  root.style.colorScheme = isDark() ? "light" : "dark";
  try {
    localStorage.setItem("event-share:theme", root.style.colorScheme);
  } catch {
    // Storage is blocked.
  }
  showTheme();
});

systemDark.addEventListener("change", showTheme);

function showFullscreen() {
  $("fullscreen").textContent = document.fullscreenElement ? "fullscreen_exit" : "fullscreen";
}

// iPhones have no fullscreen for pages.
$("fullscreen").hidden = !root.requestFullscreen;

$("fullscreen").addEventListener("click", () =>
  document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen(),
);

document.addEventListener("fullscreenchange", showFullscreen);

$("zone").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
showTheme();
showFullscreen();
load();
