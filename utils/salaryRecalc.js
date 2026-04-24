// Centralized salary-edit logic so the Add Employee and Edit Employee forms
// stay in sync.
//
// Model
// -----
// Components: basic, hra, conveyance, medical, special  (monthly amounts)
// Derived:    grossSalary = sum(components)             (monthly)
//             ctc         = grossSalary * 12            (annual)
//
// Editing rules (applied via `recalcSalary(prevSalary, field, value)`):
//   * Edit `ctc`            → newGross = ctc / 12; components scaled by
//                             (newGross / oldGross) to preserve current ratios.
//   * Edit `grossSalary`    → ctc = gross * 12; components scaled the same way.
//   * Edit a component      → that component takes the new value; the OTHER
//                             components keep their existing values; gross =
//                             sum(components); ctc = gross * 12.
//
// When `oldGross` is 0/empty (first time entering a value) we fall back to the
// canonical Indian payroll split — Basic 40%, HRA 40% of Basic, Conveyance
// ₹800, Medical 5%, Special = remainder — so the form still feels intelligent.

const COMPONENT_FIELDS = ['basic', 'hra', 'conveyance', 'medical', 'special']

const num = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export function defaultBreakdown(grossSalary) {
  const gross = num(grossSalary)
  if (gross <= 0) {
    return { basic: '', hra: '', conveyance: '', medical: '', special: '' }
  }
  const basic = Math.round(gross * 0.40)
  const hra = Math.round(basic * 0.40)
  const conveyance = 800
  const medical = Math.round(gross * 0.05)
  const special = Math.max(0, gross - basic - hra - conveyance - medical)
  return { basic, hra, conveyance, medical, special }
}

function scaleComponents(prev, ratio) {
  const out = {}
  for (const f of COMPONENT_FIELDS) {
    const cur = num(prev[f])
    out[f] = cur > 0 ? Math.round(cur * ratio) : ''
  }
  return out
}

function balanceToGross(components, gross) {
  // Adjust the LARGEST component so the sum exactly matches gross
  // (rounding can otherwise leave us a rupee or two off).
  const sum = COMPONENT_FIELDS.reduce((s, f) => s + num(components[f]), 0)
  const diff = Math.round(gross - sum)
  if (diff === 0) return components
  let bestField = COMPONENT_FIELDS[0]
  let bestVal = -Infinity
  for (const f of COMPONENT_FIELDS) {
    const v = num(components[f])
    if (v > bestVal) { bestVal = v; bestField = f }
  }
  return { ...components, [bestField]: Math.max(0, num(components[bestField]) + diff) }
}

export function recalcSalary(prevSalary, field, rawValue) {
  const prev = prevSalary || {}
  const value = rawValue === '' || rawValue == null ? '' : rawValue
  const next = { ...prev, [field]: value }

  if (field === 'ctc' || field === 'grossSalary') {
    const newGross = field === 'ctc' ? num(value) / 12 : num(value)
    const oldGross = num(prev.grossSalary)
    const componentsSum = COMPONENT_FIELDS.reduce((s, f) => s + num(prev[f]), 0)

    if (newGross <= 0) {
      // Cleared: blank components & the partner field
      next.grossSalary = field === 'grossSalary' ? value : ''
      next.ctc = field === 'ctc' ? value : ''
      for (const f of COMPONENT_FIELDS) next[f] = ''
      return next
    }

    let components
    if (componentsSum > 0 && oldGross > 0) {
      components = scaleComponents(prev, newGross / oldGross)
    } else if (componentsSum > 0) {
      // Components present but no recorded gross — scale by new/sum
      components = scaleComponents(prev, newGross / componentsSum)
    } else {
      components = defaultBreakdown(newGross)
    }

    components = balanceToGross(components, newGross)

    return {
      ...next,
      ...components,
      grossSalary: Math.round(newGross),
      ctc: Math.round(newGross * 12),
    }
  }

  if (COMPONENT_FIELDS.includes(field)) {
    const components = { ...prev, [field]: value }
    const sum = COMPONENT_FIELDS.reduce((s, f) => s + num(components[f]), 0)
    return {
      ...next,
      grossSalary: sum > 0 ? Math.round(sum) : '',
      ctc: sum > 0 ? Math.round(sum * 12) : '',
    }
  }

  return next
}
