// One Euro filter (Casiez et al. 2012): smooths jitter when still, stays responsive when moving fast.
const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

export class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0

  private minCutoff: number
  private beta: number
  private dCutoff: number

  constructor(minCutoff = 1.0, beta = 1.5, dCutoff = 1.0) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  /** `t` in seconds. */
  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value
      this.t = t
      return value
    }
    const dt = Math.max(t - this.t, 1e-3)
    this.t = t
    const dxNow = (value - this.x) / dt
    this.dx += alpha(this.dCutoff, dt) * (dxNow - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += alpha(cutoff, dt) * (value - this.x)
    return this.x
  }

  reset() {
    this.x = null
    this.dx = 0
  }
}
