// The rack face the agent reaches for, in 1920x1080 frame coordinates.
//
// Shots 3 and 5 are the SAME framing — shot 5 opens on the frame shot 3 froze —
// so the glyph and the accent line that draws under it all have to sit on the
// identical pixels or the cut at film 660 shows a jump. One constant, two call
// sites, no second copy.
//
// CALIBRATED 2026-09-03 against the real Unreal reach plate
// (studio/public/dashclaw/hall/reach/frame_0060.png, the frozen frame). The
// plate lights an orange emissive strip on the target rack face on plate frame
// 60 — film frame 390, the exact frame of THE HOLD — so the world already
// performs the accent line as a world element. A least-squares fit of that
// strip's orange pixels (restricted to x > 1080 so the agent sphere at x
// 880-990 does not contaminate it) gives 288 px from (1119, 700) to (1226, 731):
// 111 px long at 16.0 degrees. STRIP below IS that measurement.
//
// The film's drawn rule therefore COINCIDES with the strip rather than being a
// second horizontal underline beneath the glyph: one orange line at the rack,
// not two. The rule still draws (it is the only thing that moves during the
// hold) — it lays a crisp accent core inside the plate's bloom.

/**
 * The plate's own orange emissive strip on the rack face, measured. The drawn
 * rule is placed and rotated onto exactly this, so the film adds no second
 * orange mark to the hall.
 */
export const STRIP = {
  /** Left end of the strip, on its centre line. */
  x: 1119,
  y: 700,
  /** Fitted length along the strip's axis. */
  length: 112,
  /** Fitted axis, degrees clockwise from horizontal. */
  angleDeg: 16.04,
  /** Drawn core thickness; the plate's own strip measures ~16 px with bloom. */
  thickness: 4,
} as const;

export const RACK = {
  /**
   * The glyph block, centred on the strip's midpoint (x 1174.6) and sitting
   * just above its high (left) end. The visible rack face is only ~128 px wide
   * in this framing, so the command is a screen-space label attached to that
   * rack — the film's own mono chrome — rather than a texture on the face; at
   * face width it would be 15 px type and unreadable. Measured background
   * luminance in this box is mean 53 / p95 117, so ink2 (~195) reads.
   */
  x: 1052,
  y: 649,
  fontSize: 28,
  letterSpacing: 2,
} as const;

/** The command on the rack face. The film's whole argument hangs off this string. */
export const RACK_COMMAND = 'deploy --prod';
