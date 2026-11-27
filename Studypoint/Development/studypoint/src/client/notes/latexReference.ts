// The math palette in the note editor, grouped the way Alex's own "LaTeX → Math Symbol Reference" is
// (Greek, arithmetic, relations, fractions & roots, big operators, arrows, sets & logic, accents).
// Clicking an item inserts its command; the labels are plain Unicode so the palette needs no KaTeX.

export type LatexItem = { label: string; insert: string; name: string };
export type LatexGroup = { title: string; items: readonly LatexItem[] };

const g = (pairs: ReadonlyArray<[string, string, string]>): LatexItem[] => pairs.map(([label, insert, name]) => ({ label, insert, name }));

export const LATEX_GROUPS: readonly LatexGroup[] = [
  {
    title: 'Greek',
    items: g([
      ['α', '\\alpha', 'alpha'], ['β', '\\beta', 'beta'], ['γ', '\\gamma', 'gamma'], ['δ', '\\delta', 'delta'],
      ['ε', '\\varepsilon', 'epsilon'], ['θ', '\\theta', 'theta'], ['λ', '\\lambda', 'lambda'], ['μ', '\\mu', 'mu'],
      ['π', '\\pi', 'pi'], ['ρ', '\\rho', 'rho'], ['σ', '\\sigma', 'sigma'], ['τ', '\\tau', 'tau'],
      ['φ', '\\varphi', 'phi'], ['ω', '\\omega', 'omega'], ['Δ', '\\Delta', 'capital delta'], ['Σ', '\\Sigma', 'capital sigma'],
      ['Ω', '\\Omega', 'capital omega'],
    ]),
  },
  {
    title: 'Arithmetic',
    items: g([
      ['±', '\\pm', 'plus or minus'], ['×', '\\times', 'times'], ['·', '\\cdot', 'dot'], ['÷', '\\div', 'divide'],
      ['≠', '\\neq', 'not equal'], ['≈', '\\approx', 'approximately'], ['≡', '\\equiv', 'identical to'], ['∝', '\\propto', 'proportional to'],
    ]),
  },
  {
    title: 'Relations',
    items: g([
      ['≤', '\\leq', 'less or equal'], ['≥', '\\geq', 'greater or equal'], ['≪', '\\ll', 'much less than'], ['≫', '\\gg', 'much greater than'],
      ['∴', '\\therefore', 'therefore'], ['∵', '\\because', 'because'],
    ]),
  },
  {
    title: 'Fractions, roots, powers',
    items: g([
      ['a⁄b', '\\frac{a}{b}', 'fraction'], ['√x', '\\sqrt{x}', 'square root'], ['ⁿ√x', '\\sqrt[n]{x}', 'nth root'],
      ['x²', 'x^{2}', 'power'], ['xᵢ', 'x_{i}', 'subscript'], ['(ⁿₖ)', '\\binom{n}{k}', 'binomial'],
    ]),
  },
  {
    title: 'Calculus',
    items: g([
      ['∑', '\\sum_{i=1}^{n}', 'sum'], ['∏', '\\prod_{i=1}^{n}', 'product'], ['∫', '\\int_{a}^{b}', 'integral'],
      ['∬', '\\iint', 'double integral'], ['∮', '\\oint', 'contour integral'], ['lim', '\\lim_{x \\to \\infty}', 'limit'],
      ['∂', '\\partial', 'partial'], ['∇', '\\nabla', 'nabla'], ['∞', '\\infty', 'infinity'],
    ]),
  },
  {
    title: 'Arrows',
    items: g([
      ['→', '\\rightarrow', 'right arrow'], ['←', '\\leftarrow', 'left arrow'], ['↔', '\\leftrightarrow', 'left right arrow'],
      ['⇒', '\\Rightarrow', 'implies'], ['⇔', '\\Leftrightarrow', 'if and only if'], ['↦', '\\mapsto', 'maps to'],
    ]),
  },
  {
    title: 'Sets & logic',
    items: g([
      ['∈', '\\in', 'element of'], ['∉', '\\notin', 'not element of'], ['⊂', '\\subset', 'subset'], ['⊆', '\\subseteq', 'subset or equal'],
      ['∪', '\\cup', 'union'], ['∩', '\\cap', 'intersection'], ['∅', '\\emptyset', 'empty set'], ['∀', '\\forall', 'for all'],
      ['∃', '\\exists', 'there exists'], ['¬', '\\neg', 'not'],
    ]),
  },
  {
    title: 'Accents & more',
    items: g([
      ['v⃗', '\\vec{v}', 'vector'], ['x̂', '\\hat{x}', 'hat'], ['ẋ', '\\dot{x}', 'dot above'], ['x̄', '\\bar{x}', 'bar'],
      ['AB̅', '\\overline{AB}', 'overline'], ['90°', '90^\\circ', 'degrees'], ['∠', '\\angle', 'angle'], ['⊥', '\\perp', 'perpendicular'],
      ['∥', '\\parallel', 'parallel'], ['…', '\\ldots', 'ellipsis'], ['☐', '\\boxed{x=y}', 'boxed'],
    ]),
  },
];
