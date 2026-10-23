// Stage timing for the lead path. Timings are accumulated in memory and emitted
// as one structured field on the request's outcome line rather than printed per
// stage: console.time writes an unstructured line per stage, and Render records
// one log entry per line, which buries the outcome and loses correlation.
// Accumulating costs arithmetic and no I/O, so it stays on in production.
const enabled = process.env.LEAD_TIMING !== "false";

const noop = {
  name: undefined,
  time() {},
  timeEnd() {},
  endAll() {},
  stages: () => ({}),
  elapsed: () => undefined,
};

const round = (ms) => Math.round(ms * 10) / 10;

const createTimer = (name) => {
  if (!enabled) return noop;

  const startedAt = process.hrtime.bigint();
  const open = new Map();
  const stages = {};
  const msSince = (from) => round(Number(process.hrtime.bigint() - from) / 1e6);

  return {
    name,
    time(stage) {
      if (!open.has(stage)) open.set(stage, process.hrtime.bigint());
    },
    timeEnd(stage) {
      const from = open.get(stage);
      if (from === undefined) return;
      open.delete(stage);
      stages[stage] = msSince(from);
    },
    // Close anything still open (early return, thrown error, 4xx bail-out).
    endAll() {
      for (const stage of [...open.keys()]) {
        this.timeEnd(stage);
      }
    },
    stages: () => stages,
    elapsed: () => msSince(startedAt),
  };
};

// Express middleware: attaches req.timer and closes it when the response ends.
const requestTiming = (name) => (req, res, next) => {
  req.timer = createTimer(name);
  res.on("finish", () => {
    req.timer.endAll();
  });
  next();
};

export { createTimer, requestTiming };
