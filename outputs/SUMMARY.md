# Daily Summariser Benchmark: Claude Sonnet 5 Thinking Variants

Chattiest in logs: **Lemun_in_hevun** (<@1515664664619515974>) with **228** messages

## Results

| Variant | Time(s) | Chars | ≤1800 | Title | Chattiest | Bullets✗ | Censor✗ | Para 3-4 | Emoji≤2 | ALL PASS |
|---------|---------|-------|-------|-------|-----------|----------|---------|----------|---------|----------|
| sonnet5-none | 2.36 | ERROR | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| sonnet5-low | 2.08 | ERROR | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| sonnet5-medium | 2.07 | ERROR | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| sonnet5-high | 2.08 | ERROR | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

## Legend

| Check | Meaning |
|-------|---------|
| ≤1800 | Response ≤ 1800 characters (rule 8) |
| Title | Starts with "Server Talk 💬" (rule 1) |
| Chattiest | Contains `<@id> was today's chattiest with X messages!` (rule 7) |
| Bullets✗ | No bullet-point formatting (rule 4) |
| Censor✗ | No asterisk censorship (rule 9) |
| Para 3-4 | Written in 3-4 paragraphs (rule 4) |
| Emoji≤2 | ≤2 emoji per paragraph (rule 10) |
| ALL PASS | All rule checks passed |
