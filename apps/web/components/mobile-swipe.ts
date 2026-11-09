type Swipe = {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastTime: number;
  velocity: number;
  horizontal: boolean;
};

export function listenForHorizontalSwipe(
  element: HTMLElement,
  options: {
    capture?: boolean;
    axisRatio?: number;
    canStart: (touch: Touch, target: EventTarget | null) => boolean;
    canMove: (dx: number) => boolean;
    begin: () => void;
    move: (dx: number) => void;
    end: (dx: number, velocity: number) => void;
    cancel: () => void;
  },
) {
  let swipe: Swipe | null = null;
  const cancel = () => {
    const horizontal = swipe?.horizontal;
    swipe = null;
    if (horizontal) options.cancel();
  };
  const start = (event: TouchEvent) => {
    cancel();
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!options.canStart(touch, event.target)) return;
    swipe = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      lastX: touch.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
      horizontal: false,
    };
  };
  const advance = (event: TouchEvent, touch: Touch) => {
    if (!swipe || swipe.id !== touch.identifier) return;
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (!event.cancelable || event.defaultPrevented) return cancel();
    if (!swipe.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (
        Math.abs(dx) <= Math.abs(dy) * (options.axisRatio ?? 1.2) ||
        !options.canMove(dx)
      )
        return cancel();
      swipe.horizontal = true;
      options.begin();
    }
    event.preventDefault();
    event.stopPropagation();
    if (touch.clientX !== swipe.lastX) {
      const dt = Math.max(8, event.timeStamp - swipe.lastTime);
      swipe.velocity = Math.max(
        -2.4,
        Math.min(2.4, (touch.clientX - swipe.lastX) / dt),
      );
      swipe.lastX = touch.clientX;
      swipe.lastTime = event.timeStamp;
    }
    options.move(dx);
    return dx;
  };
  const move = (event: TouchEvent) => {
    if (event.touches.length !== 1) return cancel();
    advance(event, event.touches[0]);
  };
  const end = (event: TouchEvent) => {
    if (event.touches?.length) return cancel();
    const touch = Array.from(event.changedTouches).find(
      (touch) => touch.identifier === swipe?.id,
    );
    if (!touch) return;
    const dx = advance(event, touch);
    if (swipe?.horizontal && dx !== undefined) {
      const velocity =
        event.timeStamp - swipe.lastTime <= 90 ? swipe.velocity : 0;
      swipe = null;
      options.end(dx, velocity);
    } else cancel();
  };
  const capture = options.capture ?? false;
  const listeners = new AbortController();
  const signal = listeners.signal;
  element.addEventListener("touchstart", start, {
    capture,
    passive: true,
    signal,
  });
  element.addEventListener("touchmove", move, {
    capture,
    passive: false,
    signal,
  });
  element.addEventListener("touchend", end, {
    capture,
    passive: false,
    signal,
  });
  element.addEventListener("touchcancel", cancel, {
    capture,
    passive: true,
    signal,
  });
  return { cancel, destroy: () => listeners.abort() };
}

/** A critically damped spring in pixels, with a compositor-friendly paint callback. */
export function swipeMotion(
  initialPosition: number,
  clamp: (position: number) => number,
  paint: (position: number) => void,
  response: number,
) {
  let position = initialPosition;
  let frame = 0;
  let target = initialPosition;
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const set = (value: number) => {
    position = clamp(value);
    paint(position);
  };
  set(position);
  return {
    get position() {
      return position;
    },
    stop,
    set,
    settle(next: number, speed = 0, done?: () => void) {
      if (frame && target === next) return;
      stop();
      target = next;
      if (
        position === next ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        set(next);
        done?.();
        return;
      }
      const started = performance.now();
      const displacement = position - next;
      const momentum = speed * 1000 + response * displacement;
      const tick = (now: number) => {
        const elapsed = Math.max(0, now - started) / 1000;
        const decay = Math.exp(-response * elapsed);
        const delta = (displacement + momentum * elapsed) * decay;
        const velocity =
          (momentum - response * (displacement + momentum * elapsed)) * decay;
        if (Math.abs(delta) < 0.4 && Math.abs(velocity) < 9) {
          frame = 0;
          set(next);
          done?.();
        } else {
          set(next + delta);
          frame = requestAnimationFrame(tick);
        }
      };
      frame = requestAnimationFrame(tick);
    },
  };
}
