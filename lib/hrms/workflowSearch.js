// Every contiguous 1–3 character gram supports the existing substring search
// without a regex/collection-scan emulation. The final predicate removes false
// positives after Firestore narrows candidates using one indexed gram.
export function workflowSearchGrams(workflow) {
  const grams = new Set()
  for (const text of [workflow.title, workflow.caseNumber]) {
    const value = String(text || '').toLocaleLowerCase('en-US')
    for (let size = 1; size <= 3; size++) for (let index = 0; index <= value.length - size; index++) grams.add(value.slice(index, index + size))
  }
  return [...grams].sort()
}

export function workflowMatchesSearch(workflow, search) {
  const value = String(search || '').toLocaleLowerCase('en-US')
  return [workflow.title, workflow.caseNumber].some(text => String(text || '').toLocaleLowerCase('en-US').includes(value))
}
