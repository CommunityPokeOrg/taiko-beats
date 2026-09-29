# Taiko Beats

A three-key drum rhythm game for the browser, inspired by Taiko no Tatsujin —
notes scroll vertically down three lanes (left rim / drum center / right rim)
toward a hit line, DDR-style. All audio is synthesized live with WebAudio —
no external music files, no copyrighted tracks, no build step.

**Play it:** open `index.html` or visit the GitHub Pages deployment.

## Controls

| Lane            | Keys            |
|-----------------|-----------------|
| Left rim (Ka)   | `D` or `←`      |
| Drum (Don)      | `F` or `↓`      |
| Right rim (Ka)  | `J` or `→`      |

Judgment windows: **Perfect** ≤ 50 ms, **Good** ≤ 110 ms, otherwise **Miss**.
Score, combo, accuracy, and a grade (S/A/B/C/D) are shown on the results screen.
`Esc` quits a song.

Two built-in generated beatmaps are included: *Festival Beat* (96 BPM) and
*Thunder Roll* (150 BPM).

## Beatmap editor

Click **Beatmap Editor** on the menu:

- Load your own audio file, or use the built-in synthesized drum track
- BPM and offset (ms) settings
- Beat snap: 1/4, 1/8, 1/12, 1/16, 1/24, 1/32, or free placement
- Scrolling timeline with a waveform (or synth-pattern) display
- Click a lane to place a note (snapped); click/right-click a note to delete it
- `1`/`2`/`3` or `D`/`F`/`J` to toggle a note at the cursor; `Space` plays/pauses
- Drag the ruler/waveform to scrub; `←`/`→` step the cursor by the snap interval
- **Test-play** launches the map from the cursor position (`Esc` returns)
- Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`)
- Save maps to the browser (they appear under "Custom Maps" on the menu);
  export/import maps as JSON

### Map JSON format

```json
{
  "format": "taiko-beats/1",
  "name": "My Map",
  "bpm": 120,
  "offsetMs": 0,
  "lengthMs": 60000,
  "audio": "synth",
  "lanes": 3,
  "notes": [{ "t": 1000, "lane": 1 }]
}
```

`audio` is `"synth"` or `"file"`. File-based maps store only note data —
re-load the audio file after importing.

## Tech

Plain HTML / CSS / JavaScript on `<canvas>`. No dependencies, no build step.
Deployed via GitHub Pages.

## License

MIT — see [LICENSE](LICENSE).
