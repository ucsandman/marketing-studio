/** Pure telemetry recorder; timestamps are ms relative to start(). */
export class Recorder {
  #t0 = null;
  #events = [];

  start() {
    this.#t0 = performance.now();
  }

  #now() {
    if (this.#t0 === null) throw new Error('Recorder: call start() first');
    return Math.round(performance.now() - this.#t0);
  }

  step(label) {
    this.#events.push({type: 'step', t: this.#now(), label});
  }

  /**
   * Logs the click at the locator's center, then performs the real click.
   * `position` (element-relative px) aims at a point inside the element instead
   * of its center — needed for surfaces with no sub-elements to target, such as
   * a video/image that stands in for a whole screen.
   */
  async click(locator, label, {position} = {}) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Recorder: locator has no bounding box (not visible?)');
    if (label) this.step(label);
    this.#events.push({
      type: 'click',
      t: this.#now(),
      x: Math.round(box.x + (position ? position.x : box.width / 2)),
      y: Math.round(box.y + (position ? position.y : box.height / 2)),
    });
    await locator.click(position ? {position} : undefined);
  }

  /** Logs a camera focus region of w x h centered at (x, y) in viewport px. */
  focusAt(x, y, {w = 1150, h = 720} = {}) {
    this.#events.push({
      type: 'focus',
      t: this.#now(),
      x: Math.round(x),
      y: Math.round(y),
      w,
      h,
    });
  }

  /**
   * Measures a real visible subject and records its padded bounds. Capture
   * scripts should prefer this over hand-copying a click point into focusAt().
   */
  async focus(locator, {padding = 0, minWidth = 1, minHeight = 1} = {}) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Recorder: focus locator has no bounding box (not visible?)');
    this.focusAt(box.x + box.width / 2, box.y + box.height / 2, {
      w: Math.max(minWidth, Math.round(box.width + padding * 2)),
      h: Math.max(minHeight, Math.round(box.height + padding * 2)),
    });
  }

  finish(viewport) {
    return {viewport, durationMs: this.#now(), events: this.#events};
  }
}
