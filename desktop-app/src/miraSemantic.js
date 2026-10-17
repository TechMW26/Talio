'use strict';
const { createHash } = require('crypto');
// These are selection candidates, not authority to act. Native execution checks
// consent, foreground identity, snapshot freshness and live AX references again.
const EDITABLE = /^(AXTextField|AXTextArea|AXSearchField)$/;
const CLICKABLE = /^(AXButton|AXLink|AXPopUpButton|AXTextField|AXTextArea|AXSearchField)$/;
const SENSITIVE = /password|passcode|otp|verification code|credit card|cvv|secret|api.key/i;
const COMMIT = /\b(send|submit|delete|remove|purchase|pay|buy|confirm|approve|publish|transfer|install)\b|भेज|हटा|मिटा|भुगतान/i;
function semanticCandidates(targets, operation) {
  return targets.filter(t => typeof t.ref === 'string' && !SENSITIVE.test(t.label) && !COMMIT.test(t.label) &&
    (operation === 'fill' ? EDITABLE : CLICKABLE).test(t.role));
}
function semanticFingerprint(app, windowId, targets) {
  if (!targets.length) return null;
  return createHash('sha256').update(JSON.stringify([app, windowId, targets.map(({ role, label, x, y }) => [role, label, x, y])])).digest('hex');
}
module.exports = { semanticCandidates, semanticFingerprint };
