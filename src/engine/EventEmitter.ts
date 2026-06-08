type Handler<T> = (payload: T) => void;

export class EventEmitter<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.map.get(event);
    if (!set) { set = new Set(); this.map.set(event, set); }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.map.get(event)?.forEach((h) => h(payload));
  }
}
