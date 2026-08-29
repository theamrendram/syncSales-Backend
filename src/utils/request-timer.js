const { randomUUID } = require("crypto");

// Dev-only stage timing for hot endpoints. Enable/disable with LEAD_TIMING.
const enabled =
  process.env.LEAD_TIMING === "true" ||
  (process.env.LEAD_TIMING !== "false" &&
    process.env.NODE_ENV !== "production");

const noop = {
  time() {},
  timeEnd() {},
  endAll() {},
};

// console.time labels are process-global, so scope every label to one request.
const createTimer = (name) => {
  if (!enabled) return noop;

  const id = randomUUID().slice(0, 8);
  const open = new Set();
  const label = (stage) => `[${name} ${id}] ${stage}`;

  return {
    time(stage) {
      const key = label(stage);
      if (open.has(key)) return;
      open.add(key);
      console.time(key);
    },
    timeEnd(stage) {
      const key = label(stage);
      if (!open.delete(key)) return;
      console.timeEnd(key);
    },
    // Close anything still open (early return, thrown error, 4xx bail-out).
    endAll() {
      for (const key of [...open]) {
        open.delete(key);
        console.timeEnd(key);
      }
    },
  };
};

// Express middleware: attaches req.timer and brackets the whole request.
const requestTiming = (name) => (req, res, next) => {
  req.timer = createTimer(name);
  req.timer.time("TOTAL");
  res.on("finish", () => {
    req.timer.timeEnd("TOTAL");
    req.timer.endAll();
  });
  next();
};

module.exports = { createTimer, requestTiming };
