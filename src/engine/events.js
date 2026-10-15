// Tiny event emitter. Used by the engine and by games to talk to each other.
//   const events = createEvents();
//   const off = events.on('score', (n) => …);
//   events.emit('score', 10);
//   off();

export function createEvents() {
  const listeners = new Map();
  return {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    once(name, fn) {
      const off = this.on(name, (...args) => {
        off();
        fn(...args);
      });
      return off;
    },
    emit(name, ...args) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn(...args);
    },
    clear: () => listeners.clear(),
  };
}
