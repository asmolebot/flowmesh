const fs = require('fs');
const data = JSON.parse(fs.readFileSync('triage_output.json', 'utf8'));

let urgent = data.buckets.urgent || [];
let replyNeeded = data.buckets['reply-needed'] || [];
let fyi = data.buckets.fyi || [];
let archiveCandidates = data.buckets['archive-candidate'] || [];

console.log("Stats:");
console.log(`Total Messages: ${data.totalMessages}`);
console.log(`Urgent: ${urgent.length}`);
console.log(`Reply-Needed: ${replyNeeded.length}`);
console.log(`FYI: ${fyi.length}`);
console.log(`Archive/Noise: ${archiveCandidates.length}`);
console.log("\nURGENT:");
urgent.forEach(e => console.log(`- ${e.message.from[0]?.name || e.message.from[0]?.address}: ${e.message.subject}`));
console.log("\nREPLY NEEDED:");
replyNeeded.forEach(e => console.log(`- ${e.message.from[0]?.name || e.message.from[0]?.address}: ${e.message.subject}`));
console.log("\nFYI:");
fyi.forEach(e => console.log(`- ${e.message.from[0]?.name || e.message.from[0]?.address}: ${e.message.subject}`));

// Let's get frequent senders for unsubscribe candidates
const senders = {};
archiveCandidates.forEach(e => {
  const sender = e.message.from[0]?.name || e.message.from[0]?.address;
  senders[sender] = (senders[sender] || 0) + 1;
});
const frequent = Object.entries(senders).sort((a,b) => b[1] - a[1]).slice(0, 5);
console.log("\nUNSUBSCRIBE CANDIDATES:");
frequent.forEach(s => console.log(`- ${s[0]} (${s[1]} emails)`));
