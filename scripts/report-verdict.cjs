// scripts/report-verdict.cjs — append the founder's verdict to the session
// report (the file outside the repos), then return.
const fs = require('fs');
const RPT = 'D:/TODOs/farmline-thread-report.md';
if (fs.readFileSync(RPT, 'utf8').includes('THE FOUNDER\u2019S VERDICT ON THIS ENTRY')) {
  console.log('  ok (already recorded)');
  process.exit(0);
}
const add = [
  '',
  '### THE FOUNDER\u2019S VERDICT ON THIS ENTRY (2026-10-13) \u2014 RECEIVED AND RECORDED',
  '- **\u201cThe report is faithful and the build is real\u201d** \u2014 the stories land the ethos, the modal treats the visitor with Zyppar\u2019s full respect, the chip no longer slips. The corruption patterns verified gone (0 hits); the headline Amharic strings read as real Amharic (meetTitle \u2705, meetSub \u2705 per the founder\u2019s own read-back).',
  '- **THE ONE OPEN DEBT, NOW A STANDING GATE:** the Amharic and Hausa **long-form copy still needs the native pass** \u2014 and it **MUST precede any Hausa/Amharic distribution push**. No ha/am marketing, sharing campaign, or store listing goes out before the native review signs the long-form copy. The gate is recorded in the canonical PLAN (THE NATIVE-PASS GATE) and rides every future session report until the pass is done.',
  '',
].join('\n');
fs.appendFileSync(RPT, add);
console.log('  verdict appended to the session report');