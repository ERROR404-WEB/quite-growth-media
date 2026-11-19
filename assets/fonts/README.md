# Bundled fonts

Used to burn captions into videos (FFmpeg/libass with `fontsdir`), so rendering looks the same on Windows and on the Linux VPS.

| File                          | Family               | Scripts            | Source                                                                                 |
| ----------------------------- | -------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `NotoSans-Bold.ttf`           | Noto Sans            | Latin (English)    | https://github.com/notofonts/notofonts.github.io (fonts/NotoSans/hinted/ttf)           |
| `NotoSansDevanagari-Bold.ttf` | Noto Sans Devanagari | Devanagari (Hindi) | https://github.com/notofonts/notofonts.github.io (fonts/NotoSansDevanagari/hinted/ttf) |
| `NotoSansTelugu-Bold.ttf`     | Noto Sans Telugu     | Telugu             | https://github.com/notofonts/notofonts.github.io (fonts/NotoSansTelugu/hinted/ttf)     |
| `Kalam-Bold.ttf`              | Kalam                | Latin + Devanagari | https://github.com/google/fonts/tree/main/ofl/kalam (Indian Type Foundry)              |
| `Timmana-Regular.ttf`         | Timmana              | Telugu + Latin     | https://github.com/google/fonts/tree/main/ofl/timmana (Appaji Ambarisha Darbha)        |

Noto is used by the default `bold` caption style. Kalam (English and Hindi) and Timmana (Telugu) are used by the `soft_handwritten` caption style of Quiet Growth, Behtar Bano and Ninnu Nuvvu Geluvu. Timmana was picked from 14 Telugu Google Fonts after test renders (most legible at caption size with a handwritten feel).

Licence: SIL Open Font License 1.1 for all files (Noto: `OFL.txt`, Kalam: `OFL-Kalam.txt`, Timmana: `OFL-Timmana.txt`). Commercial use and embedding in videos are permitted; the fonts may be redistributed with this project but not sold on their own. Noto downloaded on 18 Nov 2026; Kalam and Timmana downloaded on 18 Nov 2026 from the official Google Fonts repository.
