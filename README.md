# Event Share

Share calendar events as a QR code or link. Whoever scans the code or opens the link can add them to their calendar.

## How it works

The app is a static page without a backend. The events are stored in the link itself, after the `#`, which a browser does not send to the server.

- **Create** turns a list of events into a link and a QR code of that link.
- **Receive** shows the events of a link and adds them to a calendar: all at once as a calendar file (.ics), or one at a time through Google Calendar, Outlook.com or Microsoft 365.

## Link format

```
https://<host>/#v=1&t=Physio&l=Main+St+1&d=30&s=20261013T1200Z&s=20261020T1200Z
```

The part after the `#` is form-urlencoded.

| Key | Meaning                            |
| --- | ---------------------------------- |
| `v` | Format version, must be `1`        |
| `t` | Title                              |
| `l` | Location                           |
| `n` | Note                               |
| `d` | Duration in minutes, 60 if not set |
| `s` | Start, creates one event           |

- `t`, `l`, `n` and `d` apply to every following `s` until they are set again.
- `s` is a UTC time `YYYYMMDDTHHMMZ` (seconds are optional), or a date `YYYYMMDD` for an all-day event.
- An all-day event lasts whole days: `d` is rounded up to full days.
- Unknown keys are ignored.

## Credits

- [Material Symbols](https://fonts.google.com/icons)
- [Noto Emoji](https://googlefonts.github.io/noto-emoji-files/?emoji=emoji_u1f5d3)
- [lean-qr](https://github.com/davidje13/lean-qr)
