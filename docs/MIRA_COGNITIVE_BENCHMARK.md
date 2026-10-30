# Mira controlled cognitive benchmark

This is an internal engineering evaluation, not IQ testing or independent
accreditation. A perfect score means only that the selected cases passed once.
The certificate must not imply complete device-level acceptance.

## Reproduce

Configure the existing server-only `DEEPSEEK_API_KEY` in `.env.local`. Never
include it in results. These opt-in tests incur normal provider usage but do not
execute any model-selected action or use private account data.

```sh
MIRA_SEMANTIC_LIVE=1 MIRA_ORCHESTRATION_LIVE=1 npx jest --runInBand --runTestsByPath tests/api/mira-semantic-live.test.js tests/api/mira-orchestration-live.test.js --json --outputFile=/tmp/mira-cognitive-live.json
MIRA_COGNITIVE_LIVE=1 npx jest --runInBand --runTestsByPath tests/api/mira-cognitive-live.test.js --json --outputFile=/tmp/mira-cognitive-new-final.json
npx jest --runInBand --testPathPatterns='mira-' --json --outputFile=/tmp/mira-cognitive-regression.json
for attempt in 1 2 3; do
  MIRA_COGNITIVE_LIVE=1 MIRA_EVIDENCE_PATH=/tmp/mira-reasoning-repeat-$attempt.json npx jest --runInBand --runTestsByPath tests/api/mira-cognitive-live.test.js --testNamePattern='calendar-overlap|state-tracking' --json --outputFile=/tmp/mira-repeat-$attempt.json
done
python3 scripts/mira-cognitive-report.py
```

Report generation needs reportlab. Render and visually inspect both PDF pages
before delivery. Preserve failures rather than rerunning until a desired score
is achieved. Repeated acceptance checks are supplemental, not extra points.
Numerical-word equivalents may be adjudicated explicitly while retaining raw
results. Never publish provider reasoning traces or credentials.

## Score and latency

Score = 10 times live cases passed divided by live cases attempted. The 51
cases cover reasoning (11), context (5), expression cues (4), languages (2),
intent routing (20), desktop continuation decisions (5), orchestration (4).
Regression checks and physical-device acceptance are reported separately.
Median/p95 timings cover the 22 short cognitive provider requests, including
complete response consumption, not end-of-speech-to-audio latency. The original
baseline was 49/51 with 938 ms median and 1403 ms p95. Comparisons are unpaired
and too small for a statistically reliable latency claim.

## Actual acceptance gates

Use a signed-in Talio desktop session with existing OS permissions. Ask Mira
to open installed Calculator, calculate 17 x 23, then correct to 17 x 24 in the
same conversation. Independently inspect the native app for 391 and 408;
assistant narration alone is not evidence. Do not modify workplace records.

For voice, verify microphone transcription, generated reply, audible playback,
English/Hindi switching, interruption without echo/self-interruption, and a
spoken dismissal closing Mira. Obtain user confirmation of audible quality.
Record version, platform and unresolved warnings. The report script contains
the observations from this supervised run; update them only after new checks.
Do not reuse these observations as automatic evidence of a future build.
