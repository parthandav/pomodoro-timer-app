// timer-worker.js
// Runs in a dedicated thread — not subject to background-tab main-thread throttling.
// Sends 'tick' messages every ~500ms (so even if Chrome slows it 2x we still get
// per-second accuracy) and a 'complete' message when the focus timer reaches zero.

let intervalId = null;
let endTime   = null;   // focus mode: absolute end timestamp (ms)
let breakStart = null;  // break mode: absolute start timestamp (ms)
let mode = null;        // 'focus' | 'break' | null

self.onmessage = function (e) {
    const { type } = e.data;

    if (type === 'start-focus') {
        stop();
        endTime = e.data.endTime;
        mode = 'focus';
        tick();                              // fire immediately for instant display
        intervalId = setInterval(tick, 500); // 500ms beats throttling

    } else if (type === 'start-break') {
        stop();
        breakStart = e.data.startTime;
        mode = 'break';
        tick();
        intervalId = setInterval(tick, 500);

    } else if (type === 'stop') {
        stop();
    }
};

function tick() {
    if (mode === 'focus') {
        const remainingMs = endTime - Date.now();
        if (remainingMs <= 0) {
            stop();
            self.postMessage({ type: 'complete' });
        } else {
            self.postMessage({ type: 'tick', remaining: Math.ceil(remainingMs / 1000) });
        }
    } else if (mode === 'break') {
        self.postMessage({ type: 'tick', elapsed: Math.floor((Date.now() - breakStart) / 1000) });
    }
}

function stop() {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
    endTime    = null;
    breakStart = null;
    mode       = null;
}
