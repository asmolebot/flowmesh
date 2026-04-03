# Initial Workflows

## 1. triage
Purpose: classify recent inbound items into actionable buckets.

Pipeline:
- pull
- normalize
- classify
- emit grouped JSON

## 2. digest
Purpose: summarize the last time window into a daily/periodic report.

Outputs:
- top threads
- pending replies
- notable senders
- suggested actions

## 3. followup
Purpose: find threads that likely need attention.

Signals:
- direct unanswered questions
- commitments with dates
- stale threads
- classifier `needsResponse=true`

## 4. receipts
Purpose: find transaction/receipt statements and emit extracted fields.

Outputs may include:
- vendor
- amount
- date
- order/reference id

## 5. archive
Purpose: plan or apply low-risk archive operations.

Requirements:
- dry-run support
- JSON action plan
- optional apply step
